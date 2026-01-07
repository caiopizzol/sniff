/**
 * WebSocket client for connecting CLI to the Proxy
 *
 * New architecture:
 * - Authenticates with userId (no token - proxy holds org token)
 * - Provides apiCall() for relaying Linear API requests through proxy
 */

import type {
  ConnectionMessage,
  AuthPayload,
  WebhookPayload,
  ApiRequest,
  ApiResponse,
} from './types'

export interface ConnectionClientOptions {
  proxyUrl: string
  organizationId: string
  userId: string
  email: string
  onWebhook: (body: string, headers: Record<string, string>) => Promise<void>
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (error: Error) => void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class ConnectionClient {
  private ws: WebSocket | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true
  private pendingRequests = new Map<string, PendingRequest>()

  constructor(private options: ConnectionClientOptions) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl =
        this.options.proxyUrl.replace(/^http/, 'ws') +
        '/connect?org=' +
        encodeURIComponent(this.options.organizationId)
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        this.authenticate()
      }

      this.ws.onmessage = async (event) => {
        const message = JSON.parse(event.data as string) as ConnectionMessage

        switch (message.type) {
          case 'auth_response':
            if (message.success) {
              this.startPing()
              this.options.onConnected?.()
              resolve()
            } else {
              reject(new Error(message.error ?? 'Authentication failed'))
            }
            break

          case 'webhook':
            const webhookPayload = message.payload as WebhookPayload
            await this.options.onWebhook(webhookPayload.body, webhookPayload.headers)
            break

          case 'api_response':
            this.handleApiResponse(message.payload as ApiResponse)
            break

          case 'pong':
            // Keep-alive acknowledged
            break
        }
      }

      this.ws.onclose = () => {
        this.cleanup()
        this.options.onDisconnected?.()
        if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = (event) => {
        this.options.onError?.(new Error('WebSocket error'))
      }
    })
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.cleanup()
    this.ws?.close()
    this.ws = null
  }

  private authenticate(): void {
    const payload: AuthPayload = {
      organizationId: this.options.organizationId,
      userId: this.options.userId,
      email: this.options.email,
    }

    this.send({ type: 'auth', payload })
  }

  /**
   * Make an API call through the proxy
   * The proxy will forward the request to Linear using the org's agent token
   */
  async apiCall<T>(
    endpoint: string,
    options: { method?: ApiRequest['method']; body?: unknown } = {},
  ): Promise<T> {
    const id = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })

      const payload: ApiRequest = {
        id,
        method: options.method ?? 'POST',
        endpoint,
        body: options.body,
      }

      this.send({ type: 'api', payload })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('API call timeout'))
        }
      }, 30_000)
    })
  }

  private handleApiResponse(response: ApiResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    this.pendingRequests.delete(response.id)

    if (response.error || response.status >= 400) {
      pending.reject(new Error(response.error ?? `API error: ${response.status}`))
    } else {
      pending.resolve(response.body)
    }
  }

  private send(message: ConnectionMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' })
    }, 30_000)
  }

  private scheduleReconnect(): void {
    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        this.options.onError?.(error)
      })
    }, 5_000)
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    // Reject all pending API requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Connection closed'))
    }
    this.pendingRequests.clear()
  }
}
