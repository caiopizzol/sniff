/**
 * Durable Object for handling persistent WebSocket connections
 * Each organization gets its own instance
 *
 * New architecture:
 * - Stores org's agent token (from actor=app OAuth)
 * - Tracks registered users
 * - Routes webhooks to specific user's CLI based on creatorId
 * - Relays Linear API calls using org token
 */

import type {
  ConnectionMessage,
  AuthPayload,
  WebhookPayload,
  ApiRequest,
  ApiResponse,
} from '@sniff/connection'

interface Env {
  LINEAR_CLIENT_ID: string
  LINEAR_CLIENT_SECRET: string
  PROXY_URL: string
}

/**
 * Org state persisted in Durable Object storage
 */
interface OrgState {
  // Org agent token (from actor=app OAuth)
  agentToken?: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scope: string
  }
  // Registered users in this org
  users: Record<
    string,
    {
      userId: string
      email: string
      name: string
    }
  >
}

/**
 * WebSocket attachment for tracking authenticated connections
 */
interface WsAttachment {
  authenticated: boolean
  userId?: string
  email?: string
}

export class ConnectionHandler implements DurableObject {
  private orgState: OrgState = { users: {} }
  private initialized = false

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  /**
   * Load org state from storage on first request
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    const stored = await this.state.storage.get<OrgState>('orgState')
    if (stored) {
      this.orgState = stored
    }
    this.initialized = true
  }

  /**
   * Save org state to storage
   */
  private async saveState(): Promise<void> {
    await this.state.storage.put('orgState', this.orgState)
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized()
    const url = new URL(request.url)

    // Internal: forward webhook to connected CLI
    if (url.pathname === '/forward-webhook' && request.method === 'POST') {
      return this.handleForwardWebhook(request)
    }

    // Internal: set org token (from admin OAuth)
    if (url.pathname === '/set-org-token' && request.method === 'POST') {
      return this.handleSetOrgToken(request)
    }

    // Internal: check if org has token configured
    if (url.pathname === '/has-org-token' && request.method === 'GET') {
      return this.handleHasOrgToken()
    }

    // Internal: register user in org
    if (url.pathname === '/register-user' && request.method === 'POST') {
      return this.handleRegisterUser(request)
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ authenticated: false } as WsAttachment)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const message = JSON.parse(data as string) as ConnectionMessage

    switch (message.type) {
      case 'auth':
        await this.handleAuth(ws, message.payload as AuthPayload)
        break
      case 'api':
        await this.handleApiRelay(ws, message.payload as ApiRequest)
        break
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  async webSocketClose(): Promise<void> {}
  async webSocketError(): Promise<void> {}

  // ============================================================================
  // Internal HTTP handlers
  // ============================================================================

  /**
   * Forward webhook to appropriate CLI based on creatorId
   */
  private async handleForwardWebhook(request: Request): Promise<Response> {
    const { body, headers } = (await request.json()) as {
      body: string
      headers: Record<string, string>
    }

    // Parse webhook to get creatorId for routing
    let creatorId: string | undefined
    try {
      const webhook = JSON.parse(body)
      creatorId = webhook.agentSession?.creatorId
    } catch {
      // Ignore parse errors, will broadcast
    }

    // Find WebSocket for the user who triggered this webhook
    const allWs = this.state.getWebSockets()
    let targetWs: WebSocket | undefined

    if (creatorId) {
      targetWs = allWs.find((ws) => {
        const attachment = ws.deserializeAttachment() as WsAttachment
        return attachment?.authenticated && attachment?.userId === creatorId
      })
    }

    // Fallback: send to first available authenticated CLI
    if (!targetWs) {
      targetWs = allWs.find((ws) => {
        const attachment = ws.deserializeAttachment() as WsAttachment
        return attachment?.authenticated
      })
    }

    if (!targetWs) {
      return new Response('No connected CLI', { status: 503 })
    }

    const payload: WebhookPayload = { body, headers }
    targetWs.send(JSON.stringify({ type: 'webhook', payload }))
    return new Response(null, { status: 200 })
  }

  /**
   * Store org's agent token (from admin OAuth with actor=app)
   */
  private async handleSetOrgToken(request: Request): Promise<Response> {
    const token = (await request.json()) as OrgState['agentToken']
    this.orgState.agentToken = token
    await this.saveState()
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Check if org has agent token configured
   */
  private handleHasOrgToken(): Response {
    if (this.orgState.agentToken) {
      return new Response(JSON.stringify({ hasToken: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ hasToken: false }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Register a user in this org
   */
  private async handleRegisterUser(request: Request): Promise<Response> {
    const user = (await request.json()) as { userId: string; email: string; name: string }
    this.orgState.users[user.userId] = user
    await this.saveState()
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ============================================================================
  // WebSocket message handlers
  // ============================================================================

  /**
   * Handle CLI authentication
   * CLI sends userId (no token), we validate they're registered
   */
  private async handleAuth(ws: WebSocket, payload: AuthPayload): Promise<void> {
    // Validate org has token configured
    if (!this.orgState.agentToken) {
      ws.send(
        JSON.stringify({
          type: 'auth_response',
          success: false,
          error: 'Organization not configured',
        }),
      )
      return
    }

    // Validate user is registered in this org
    const user = this.orgState.users[payload.userId]
    if (!user) {
      ws.send(
        JSON.stringify({
          type: 'auth_response',
          success: false,
          error: 'User not registered',
        }),
      )
      return
    }

    // Mark WebSocket as authenticated with user info for routing
    ws.serializeAttachment({
      authenticated: true,
      userId: payload.userId,
      email: payload.email,
    } as WsAttachment)

    ws.send(
      JSON.stringify({
        type: 'auth_response',
        success: true,
        organizationId: payload.organizationId,
      }),
    )
  }

  /**
   * Relay API calls to Linear using org's agent token
   */
  private async handleApiRelay(ws: WebSocket, payload: ApiRequest): Promise<void> {
    const { id, method, endpoint, body } = payload

    // Validate authenticated
    const attachment = ws.deserializeAttachment() as WsAttachment
    if (!attachment?.authenticated) {
      ws.send(
        JSON.stringify({
          type: 'api_response',
          payload: { id, status: 401, error: 'Not authenticated' },
        }),
      )
      return
    }

    // Get org token (refresh if needed)
    const accessToken = await this.getOrgToken()
    if (!accessToken) {
      ws.send(
        JSON.stringify({
          type: 'api_response',
          payload: { id, status: 500, error: 'No org token' },
        }),
      )
      return
    }

    try {
      // Make Linear API call
      const response = await fetch(`https://api.linear.app${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      })

      const responseBody = await response.json()

      const apiResponse: ApiResponse = {
        id,
        status: response.status,
        body: responseBody,
      }

      ws.send(JSON.stringify({ type: 'api_response', payload: apiResponse }))
    } catch (error) {
      const apiResponse: ApiResponse = {
        id,
        status: 500,
        body: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
      ws.send(JSON.stringify({ type: 'api_response', payload: apiResponse }))
    }
  }

  // ============================================================================
  // Token management
  // ============================================================================

  /**
   * Get org's access token, refreshing if needed
   */
  private async getOrgToken(): Promise<string | null> {
    if (!this.orgState.agentToken) return null

    // Check if token needs refresh (5 min buffer)
    const now = Date.now()
    const expiresAt = this.orgState.agentToken.expiresAt
    if (expiresAt && now > expiresAt - 5 * 60 * 1000) {
      await this.refreshOrgToken()
    }

    return this.orgState.agentToken?.accessToken ?? null
  }

  /**
   * Refresh the org's access token
   */
  private async refreshOrgToken(): Promise<void> {
    if (!this.orgState.agentToken?.refreshToken) return

    try {
      const response = await fetch('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.orgState.agentToken.refreshToken,
          client_id: this.env.LINEAR_CLIENT_ID,
          client_secret: this.env.LINEAR_CLIENT_SECRET,
        }),
      })

      if (!response.ok) {
        console.error('Token refresh failed:', await response.text())
        return
      }

      const tokens = (await response.json()) as {
        access_token: string
        refresh_token?: string
        expires_in: number
      }

      this.orgState.agentToken = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? this.orgState.agentToken.refreshToken,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scope: this.orgState.agentToken.scope,
      }

      await this.saveState()
    } catch (error) {
      console.error('Token refresh error:', error)
    }
  }
}
