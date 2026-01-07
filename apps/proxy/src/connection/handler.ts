/**
 * WebSocket upgrade handler
 */

import type { Env } from '../index'

export async function handleConnectionUpgrade(
  request: Request,
  env: Env,
): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 })
  }

  // Organization ID comes from query param (set by CLI during connect)
  const url = new URL(request.url)
  const organizationId = url.searchParams.get('org')

  if (!organizationId) {
    return new Response('Missing organization ID', { status: 400 })
  }

  // Get or create Durable Object for this organization
  const id = env.CONNECTION_HANDLER.idFromName(organizationId)
  const stub = env.CONNECTION_HANDLER.get(id)

  return stub.fetch(request)
}

/**
 * Forward webhook to connected CLI via Durable Object
 */
export async function forwardWebhookToConnection(
  organizationId: string,
  body: string,
  headers: Record<string, string>,
  env: Env,
): Promise<boolean> {
  const id = env.CONNECTION_HANDLER.idFromName(organizationId)
  const stub = env.CONNECTION_HANDLER.get(id)

  const response = await stub.fetch(
    new Request('https://internal/forward-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, headers }),
    }),
  )

  return response.ok
}

/**
 * Forward any request to the org's Durable Object
 * Used for internal operations like checking/setting org token, registering users
 */
export async function forwardToConnectionHandler(
  organizationId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const id = env.CONNECTION_HANDLER.idFromName(organizationId)
  const stub = env.CONNECTION_HANDLER.get(id)
  return stub.fetch(request)
}
