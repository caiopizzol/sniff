/**
 * Sniff Proxy Worker
 * @module @sniff-dev/proxy
 *
 * Cloudflare Worker that:
 * 1. Receives Linear webhooks and forwards them to connected CLIs
 * 2. Handles OAuth callbacks and redirects to local
 * 3. Maintains WebSocket connections with CLIs via Durable Objects
 */

import { handleOAuth, handleOAuthCallback, handleAgentOAuthCallback, handleTokenRefresh } from './routes/oauth'
import { handleWebhook } from './routes/webhook'
import { handleConnectionUpgrade } from './connection/handler'

export { ConnectionHandler } from './connection/durable-object'

export interface Env {
  // Secrets (set via wrangler secret put)
  LINEAR_CLIENT_ID: string
  LINEAR_CLIENT_SECRET: string
  WEBHOOK_SECRET?: string

  // Durable Objects
  CONNECTION_HANDLER: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Linear-Signature',
        },
      })
    }

    // WebSocket connection for CLI
    if (url.pathname === '/connect') {
      return handleConnectionUpgrade(request, env)
    }

    // Webhook endpoint
    if (url.pathname === '/webhook/linear' && request.method === 'POST') {
      return handleWebhook(request, env)
    }

    // OAuth start
    if (url.pathname === '/auth/linear' && request.method === 'GET') {
      return handleOAuth(request, env)
    }

    // OAuth callback (user flow)
    if (url.pathname === '/auth/linear/callback' && request.method === 'GET') {
      return handleOAuthCallback(request, env)
    }

    // OAuth callback (agent/admin flow - actor=app)
    if (url.pathname === '/auth/linear/agent-callback' && request.method === 'GET') {
      return handleAgentOAuthCallback(request, env)
    }

    // Token refresh
    if (url.pathname === '/auth/linear/refresh' && request.method === 'POST') {
      return handleTokenRefresh(request, env)
    }

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('OK', { status: 200 })
    }

    return new Response('Not Found', { status: 404 })
  },
}
