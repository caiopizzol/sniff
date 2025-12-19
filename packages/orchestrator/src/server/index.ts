/**
 * Local HTTP server using Bun.serve
 */

import { logger } from '@sniff/core'

export interface LocalServerOptions {
  port: number
  onWebhook?: (request: Request) => Promise<Response>
  onOAuthCallback?: (platform: string, tokens: OAuthTokens) => Promise<Response>
  onHealth?: () => Promise<Response>
}

export interface OAuthTokens {
  access_token: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export class LocalServer {
  private server: ReturnType<typeof Bun.serve> | null = null
  private options: LocalServerOptions

  constructor(options: LocalServerOptions) {
    this.options = options
  }

  /**
   * Start the server, trying next port if in use
   */
  start(maxRetries = 10): number {
    const { onWebhook, onOAuthCallback, onHealth } = this.options
    let port = this.options.port

    for (let i = 0; i < maxRetries; i++) {
      try {
        this.server = Bun.serve({
          port,
          fetch: async (request) => {
            const url = new URL(request.url)

            // Health check
            if (url.pathname === '/health' && request.method === 'GET') {
              if (onHealth) {
                return onHealth()
              }
              return new Response('OK', { status: 200 })
            }

            // OAuth callback from proxy
            if (url.pathname === '/oauth/callback' && request.method === 'POST') {
              if (!onOAuthCallback) {
                return new Response('OAuth callback not configured', { status: 404 })
              }
              try {
                const body = (await request.json()) as { platform: string; tokens: OAuthTokens }
                return onOAuthCallback(body.platform, body.tokens)
              } catch (error) {
                logger.error('OAuth callback error', {
                  error: error instanceof Error ? error.message : String(error),
                })
                return new Response('Invalid request', { status: 400 })
              }
            }

            // Webhook endpoint
            if (url.pathname === '/webhook/linear' && request.method === 'POST') {
              if (!onWebhook) {
                return new Response('Webhook handler not configured', { status: 404 })
              }
              return onWebhook(request)
            }

            return new Response('Not Found', { status: 404 })
          },
          error(error) {
            logger.error('Server error', { error: error.message })
            return new Response('Internal Server Error', { status: 500 })
          },
        })
        this.options.port = port
        logger.info(`Local server started on port ${port}`)
        return port
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'EADDRINUSE') {
          logger.warn(`Port ${port} in use, trying ${port + 1}`)
          port++
        } else {
          throw e
        }
      }
    }
    throw new Error(`Could not find available port after ${maxRetries} attempts`)
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.stop()
      this.server = null
      logger.info('Local server stopped')
    }
  }

  /**
   * Get the server URL
   */
  get url(): string | null {
    if (!this.server) return null
    return `http://localhost:${this.options.port}`
  }
}

export { LocalServer as default }
