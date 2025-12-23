/**
 * Durable Object for handling persistent WebSocket connections
 * Each organization gets its own instance
 */

import type { ConnectionMessage, AuthPayload, WebhookPayload } from '@sniff/connection'

interface Env {
  LINEAR_CLIENT_ID: string
  LINEAR_CLIENT_SECRET: string
}

export class ConnectionHandler implements DurableObject {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Internal: forward webhook to connected CLI
    if (url.pathname === '/forward-webhook' && request.method === 'POST') {
      const { body, headers } = (await request.json()) as {
        body: string
        headers: Record<string, string>
      }
      const ws = this.state.getWebSockets().find(
        (ws) => ws.deserializeAttachment()?.authenticated,
      )
      if (!ws) return new Response(null, { status: 503 })

      const payload: WebhookPayload = { body, headers }
      ws.send(JSON.stringify({ type: 'webhook', payload }))
      return new Response(null, { status: 200 })
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ authenticated: false })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const message = JSON.parse(data as string) as ConnectionMessage

    if (message.type === 'auth') {
      await this.handleAuth(ws, message.payload as AuthPayload)
    } else if (message.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }))
    }
  }

  async webSocketClose(): Promise<void> {}
  async webSocketError(): Promise<void> {}

  private async handleAuth(ws: WebSocket, payload: AuthPayload): Promise<void> {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${payload.accessToken}`,
      },
      body: JSON.stringify({ query: `{ organization { id name } }` }),
    })

    if (!response.ok) {
      ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'Invalid token' }))
      return
    }

    const data = (await response.json()) as {
      data?: { organization: { id: string; name: string } }
    }

    if (data.data?.organization.id !== payload.organizationId) {
      ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'Org mismatch' }))
      return
    }

    // Mark as authenticated (survives hibernation)
    ws.serializeAttachment({ authenticated: true })

    ws.send(JSON.stringify({
      type: 'auth_response',
      success: true,
      organizationId: data.data.organization.id,
      organizationName: data.data.organization.name,
    }))
  }
}
