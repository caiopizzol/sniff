/**
 * Sniff Proxy Worker
 * @module @sniff-dev/proxy
 *
 * Cloudflare Worker that:
 * 1. Receives Linear webhooks and forwards them to the local agent
 * 2. Handles OAuth callbacks and redirects to local
 */

import { handleOAuth, handleOAuthCallback } from './routes/oauth'
import { handleWebhook } from './routes/webhook'

export interface Env {
  // Secrets (set via wrangler secret put)
  LINEAR_CLIENT_ID: string
  LINEAR_CLIENT_SECRET: string
  WEBHOOK_SECRET?: string

  // Variables (set in wrangler.toml or dashboard)
  TUNNEL_URL?: string
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

    // Webhook endpoint
    if (url.pathname === '/webhook/linear' && request.method === 'POST') {
      return handleWebhook(request, env)
    }

    // OAuth start
    if (url.pathname === '/auth/linear' && request.method === 'GET') {
      return handleOAuth(request, env)
    }

    // OAuth callback
    if (url.pathname === '/auth/linear/callback' && request.method === 'GET') {
      return handleOAuthCallback(request, env)
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 })
    }

    return new Response('Not Found', { status: 404 })
  },
}
