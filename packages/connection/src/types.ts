/**
 * Shared types for WebSocket connection between CLI and Proxy
 */

export type MessageType =
  | 'auth'
  | 'auth_response'
  | 'webhook'
  | 'ping'
  | 'pong'
  | 'api'
  | 'api_response'

export interface ConnectionMessage {
  type: MessageType
  payload?: unknown
  success?: boolean
  error?: string
}

/**
 * Auth payload - now uses userId instead of accessToken
 * The proxy holds the org's agent token, CLI just identifies the user
 */
export interface AuthPayload {
  organizationId: string
  userId: string
  email: string
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

/**
 * API relay - CLI sends requests, proxy forwards with org token
 */
export interface ApiRequest {
  id: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  body?: unknown
}

export interface ApiResponse {
  id: string
  status: number
  body: unknown
  error?: string
}
