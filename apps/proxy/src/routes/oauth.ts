/**
 * OAuth handling for Linear
 *
 * New architecture:
 * 1. User OAuth (no actor param) → validate user, check if org configured
 * 2. If org not configured + user is admin → auto-redirect to actor=app
 * 3. Actor=app OAuth → store org token in Durable Object
 */

import type { Env } from '../index'
import { forwardToConnectionHandler } from '../connection/handler'

const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize'
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

interface OAuthState {
  csrf: string
  callback?: string
  flow?: 'user' | 'agent'
  orgId?: string
}

/**
 * Encode state as base64 JSON
 */
function encodeState(state: OAuthState): string {
  return btoa(JSON.stringify(state))
}

/**
 * Decode state from base64 JSON
 */
function decodeState(encoded: string): OAuthState | null {
  try {
    return JSON.parse(atob(encoded))
  } catch {
    return null
  }
}

/**
 * Fetch user info from Linear API
 */
async function fetchUserInfo(accessToken: string): Promise<{
  userId: string
  email: string
  name: string
  admin: boolean
  organizationId: string
  organizationName: string
} | null> {
  try {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: `query {
          viewer { id email name admin }
          organization { id name }
        }`,
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      data?: {
        viewer: { id: string; email: string; name: string; admin: boolean }
        organization: { id: string; name: string }
      }
    }

    if (!data.data) return null

    return {
      userId: data.data.viewer.id,
      email: data.data.viewer.email,
      name: data.data.viewer.name,
      admin: data.data.viewer.admin,
      organizationId: data.data.organization.id,
      organizationName: data.data.organization.name,
    }
  } catch {
    return null
  }
}

/**
 * Start OAuth flow (user validation - no actor param)
 */
export async function handleOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const redirectUri = `${url.origin}/auth/linear/callback`

  // Get local callback URL from query params
  const localCallback = url.searchParams.get('callback')

  // Generate state with CSRF token and callback URL
  const state: OAuthState = {
    csrf: crypto.randomUUID(),
    callback: localCallback || undefined,
    flow: 'user',
  }

  const authUrl = new URL(LINEAR_AUTH_URL)
  authUrl.searchParams.set('client_id', env.LINEAR_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  // No actor param = user token for validation
  authUrl.searchParams.set('scope', 'read')
  authUrl.searchParams.set('state', encodeState(state))

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString() },
  })
}

/**
 * Handle OAuth callback (smart routing)
 */
export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 })
  }

  if (!code) {
    return new Response('Missing authorization code', { status: 400 })
  }

  // Decode state
  const state = stateParam ? decodeState(stateParam) : null
  const callbackUrl = state?.callback

  if (!callbackUrl) {
    return new Response('Missing callback URL in state', { status: 400 })
  }

  // Exchange code for token
  const redirectUri = `${url.origin}/auth/linear/callback`

  try {
    const tokenResponse = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.LINEAR_CLIENT_ID,
        client_secret: env.LINEAR_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      return new Response(`Token exchange failed: ${errorText}`, { status: 400 })
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }

    // Fetch user info
    const userInfo = await fetchUserInfo(tokens.access_token)
    if (!userInfo) {
      return returnToCli(callbackUrl, {
        success: false,
        error: 'Failed to fetch user info',
      })
    }

    // Check if org has Sniff configured
    const hasOrgToken = await checkOrgHasToken(userInfo.organizationId, env)

    if (hasOrgToken) {
      // ORG CONFIGURED: Register user and return success
      await registerUserInOrg(userInfo.organizationId, userInfo, env)

      return returnToCli(callbackUrl, {
        success: true,
        action: 'joined',
        userId: userInfo.userId,
        email: userInfo.email,
        name: userInfo.name,
        organizationId: userInfo.organizationId,
        organizationName: userInfo.organizationName,
      })
    }

    // ORG NOT CONFIGURED
    if (userInfo.admin) {
      // Admin: auto-redirect to actor=app OAuth
      const agentState: OAuthState = {
        csrf: crypto.randomUUID(),
        callback: callbackUrl,
        flow: 'agent',
        orgId: userInfo.organizationId,
      }

      const agentAuthUrl = new URL(LINEAR_AUTH_URL)
      agentAuthUrl.searchParams.set('client_id', env.LINEAR_CLIENT_ID)
      agentAuthUrl.searchParams.set('redirect_uri', `${url.origin}/auth/linear/agent-callback`)
      agentAuthUrl.searchParams.set('response_type', 'code')
      agentAuthUrl.searchParams.set('actor', 'app')
      agentAuthUrl.searchParams.set('scope', 'read write app:assignable app:mentionable')
      agentAuthUrl.searchParams.set('state', encodeState(agentState))

      return new Response(null, {
        status: 302,
        headers: { Location: agentAuthUrl.toString() },
      })
    } else {
      // Non-admin: return error
      return returnToCli(callbackUrl, {
        success: false,
        error: 'org_not_configured',
        message: 'Organization not set up for Sniff. Ask a workspace admin to run `sniff auth linear`.',
      })
    }
  } catch (error) {
    return new Response(`OAuth error: ${error}`, { status: 500 })
  }
}

/**
 * Handle agent OAuth callback (actor=app)
 * Stores org token in Durable Object
 */
export async function handleAgentOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 })
  }

  if (!code) {
    return new Response('Missing authorization code', { status: 400 })
  }

  // Decode state
  const state = stateParam ? decodeState(stateParam) : null
  const callbackUrl = state?.callback

  if (!callbackUrl) {
    return new Response('Missing callback URL in state', { status: 400 })
  }

  // Exchange code for agent token
  const redirectUri = `${url.origin}/auth/linear/agent-callback`

  try {
    const tokenResponse = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.LINEAR_CLIENT_ID,
        client_secret: env.LINEAR_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      return returnToCli(callbackUrl, {
        success: false,
        error: `Token exchange failed: ${errorText}`,
      })
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }

    // Get org info from agent token
    const orgInfo = await fetchOrgInfo(tokens.access_token)
    if (!orgInfo) {
      return returnToCli(callbackUrl, {
        success: false,
        error: 'Failed to fetch organization info',
      })
    }

    // Store org token in Durable Object
    await storeOrgToken(orgInfo.organizationId, tokens, env)

    // Also fetch and register the admin user
    // We need to get user info, but actor=app token might not have viewer
    // So we use the org ID from state if available
    const userInfo = await fetchUserInfoFromAgentToken(tokens.access_token)

    if (userInfo) {
      await registerUserInOrg(orgInfo.organizationId, userInfo, env)
    }

    return returnToCli(callbackUrl, {
      success: true,
      action: 'configured',
      organizationId: orgInfo.organizationId,
      organizationName: orgInfo.organizationName,
      userId: userInfo?.userId,
      email: userInfo?.email,
      name: userInfo?.name,
    })
  } catch (error) {
    return returnToCli(callbackUrl, {
      success: false,
      error: String(error),
    })
  }
}

/**
 * Handle token refresh (kept for backwards compatibility)
 */
export async function handleTokenRefresh(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { refreshToken?: string }
    const refreshToken = body?.refreshToken

    if (!refreshToken) {
      return new Response(JSON.stringify({ error: 'Missing refresh token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const tokenResponse = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env.LINEAR_CLIENT_ID,
        client_secret: env.LINEAR_CLIENT_SECRET,
        refresh_token: refreshToken,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      return new Response(JSON.stringify({ error: `Token refresh failed: ${errorText}` }), {
        status: tokenResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const tokens = await tokenResponse.json()
    return new Response(JSON.stringify(tokens), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Check if org has agent token configured
 */
async function checkOrgHasToken(organizationId: string, env: Env): Promise<boolean> {
  try {
    const response = await forwardToConnectionHandler(
      organizationId,
      new Request('http://internal/has-org-token', { method: 'GET' }),
      env,
    )
    return response.ok
  } catch {
    return false
  }
}

/**
 * Register user in org's Durable Object
 */
async function registerUserInOrg(
  organizationId: string,
  userInfo: { userId: string; email: string; name: string },
  env: Env,
): Promise<void> {
  await forwardToConnectionHandler(
    organizationId,
    new Request('http://internal/register-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userInfo),
    }),
    env,
  )
}

/**
 * Store org token in Durable Object
 */
async function storeOrgToken(
  organizationId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string },
  env: Env,
): Promise<void> {
  await forwardToConnectionHandler(
    organizationId,
    new Request('http://internal/set-org-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
        scope: tokens.scope,
      }),
    }),
    env,
  )
}

/**
 * Fetch org info from agent token
 */
async function fetchOrgInfo(
  accessToken: string,
): Promise<{ organizationId: string; organizationName: string } | null> {
  try {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: `query { organization { id name } }`,
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      data?: { organization: { id: string; name: string } }
    }

    if (!data.data) return null

    return {
      organizationId: data.data.organization.id,
      organizationName: data.data.organization.name,
    }
  } catch {
    return null
  }
}

/**
 * Try to fetch user info from agent token (may not work for all agent tokens)
 */
async function fetchUserInfoFromAgentToken(
  accessToken: string,
): Promise<{ userId: string; email: string; name: string } | null> {
  try {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: `query { viewer { id email name } }`,
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      data?: { viewer: { id: string; email: string; name: string } }
    }

    if (!data.data?.viewer) return null

    return {
      userId: data.data.viewer.id,
      email: data.data.viewer.email,
      name: data.data.viewer.name,
    }
  } catch {
    return null
  }
}

/**
 * Return result to CLI via browser redirect
 */
function returnToCli(
  callbackUrl: string,
  result: Record<string, unknown>,
): Response {
  // Return HTML page that sends result to CLI
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sniff</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f0f0f; color: #f5f0e8; }
    .card { text-align: center; padding: 2.5rem 3rem; background: rgba(37,33,25,0.5); border: 1px solid #3d3428; border-radius: 12px; min-width: 280px; }
    .icon { width: 56px; height: 56px; margin: 0 auto 1.5rem; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
    .icon svg { width: 28px; height: 28px; }
    .icon-ok { background: rgba(125,173,106,0.1); }
    .icon-ok svg { color: #7dad6a; }
    .icon-err { background: rgba(239,68,68,0.1); }
    .icon-err svg { color: #ef4444; }
    .icon-spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 600; }
    p { margin: 0; color: #a89f8f; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card" id="c">
    <div class="icon icon-spin"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="31.4" stroke-linecap="round"/></svg></div>
    <h1>Connecting...</h1>
  </div>
  <script>
    (async () => {
      const c = document.getElementById('c');
      const result = ${JSON.stringify(result)};
      try {
        const r = await fetch('${callbackUrl}/oauth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: 'linear', result })
        });
        if (r.ok && result.success) {
          c.innerHTML = '<div class="icon icon-ok"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div><h1>Done</h1><p>You can close this window.</p>';
        } else {
          c.innerHTML = '<div class="icon icon-err"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></div><h1>Failed</h1><p>' + (result.message || result.error || 'Unknown error') + '</p>';
        }
      } catch (e) {
        c.innerHTML = '<div class="icon icon-err"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></div><h1>Failed</h1><p>Could not reach CLI. Is it running?</p>';
      }
    })();
  </script>
</body>
</html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    },
  )
}
