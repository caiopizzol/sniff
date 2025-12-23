/**
 * Shared types for WebSocket connection between CLI and Proxy
 */

export type MessageType = 'auth' | 'auth_response' | 'webhook' | 'ping' | 'pong'

export interface ConnectionMessage {
  type: MessageType
  payload?: unknown
  success?: boolean
  error?: string
}

export interface AuthPayload {
  accessToken: string
  organizationId: string
}

export interface AuthResponse {
  success: boolean
  error?: string
  organizationId?: string
  organizationName?: string
}

export interface WebhookPayload {
  body: string
  headers: Record<string, string>
}
