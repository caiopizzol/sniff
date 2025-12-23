/**
 * WebSocket client for connecting CLI to the Proxy
 */

import type {
  ConnectionMessage,
  AuthPayload,
  AuthResponse,
  WebhookPayload,
} from './types'

export interface ConnectionClientOptions {
  proxyUrl: string
  organizationId: string
  accessToken: string
  onWebhook: (body: string, headers: Record<string, string>) => Promise<void>
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (error: Error) => void
}

export class ConnectionClient {
  private ws: WebSocket | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true

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
            const payload = message.payload as WebhookPayload
            await this.options.onWebhook(payload.body, payload.headers)
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
      accessToken: this.options.accessToken,
      organizationId: this.options.organizationId,
    }

    this.send({ type: 'auth', payload })
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
  }
}
