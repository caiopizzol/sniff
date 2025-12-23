/**
 * Webhook forwarding handler
 */

import type { Env } from '../index'
import { forwardWebhookToConnection } from '../connection/handler'

/**
 * Verify Linear webhook signature
 */
async function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))

  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return signature === expectedSignature
}

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text()
  console.log('Received webhook:', body)
  // Verify signature if secret is set
  if (env.WEBHOOK_SECRET) {
    const signature = request.headers.get('linear-signature')
    if (!signature) {
      return new Response('Missing signature', { status: 401 })
    }

    const isValid = await verifySignature(body, signature, env.WEBHOOK_SECRET)
    if (!isValid) {
      return new Response('Invalid signature', { status: 401 })
    }
  }

  // Parse webhook to get organization ID
  let organizationId: string
  try {
    const webhook = JSON.parse(body) as { organizationId?: string }
    if (!webhook.organizationId) {
      return new Response('Missing organization ID in webhook', { status: 400 })
    }
    organizationId = webhook.organizationId
  } catch {
    return new Response('Invalid webhook payload', { status: 400 })
  }

  // Forward to connected CLI via Durable Object
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'linear-signature': request.headers.get('linear-signature') ?? '',
    'x-forwarded-for': request.headers.get('cf-connecting-ip') ?? '',
  }

  const success = await forwardWebhookToConnection(organizationId, body, headers, env)

  if (!success) {
    return new Response('No CLI connected for this organization', { status: 503 })
  }

  return new Response('OK', { status: 200 })
}
