/**
 * OAuth handling for Linear
 */

import type { Env } from '../index'

const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize'
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'

interface OAuthState {
  csrf: string
  callback?: string
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
 * Start OAuth flow
 */
export async function handleOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const redirectUri = `${url.origin}/auth/linear/callback`

  // Get local callback URL from query params
  const localCallback = url.searchParams.get('callback')

  // Generate state with CSRF token and optional callback URL
  const state: OAuthState = {
    csrf: crypto.randomUUID(),
    callback: localCallback || undefined,
  }

  const authUrl = new URL(LINEAR_AUTH_URL)
  authUrl.searchParams.set('client_id', env.LINEAR_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  // Use actor=app for Linear Agents API access
  // Scopes: read write for general API, app:assignable app:mentionable for agent features
  authUrl.searchParams.set('actor', 'app')
  authUrl.searchParams.set('scope', 'read write app:assignable app:mentionable')
  authUrl.searchParams.set('state', encodeState(state))

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
    },
  })
}

/**
 * Handle OAuth callback
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

  // Decode state to get callback URL
  const state = stateParam ? decodeState(stateParam) : null
  const callbackUrl = state?.callback || env.TUNNEL_URL

  // Exchange code for token
  const redirectUri = `${url.origin}/auth/linear/callback`

  try {
    const tokenResponse = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
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

    const tokens = await tokenResponse.json()

    // Return page that sends tokens to local CLI via browser
    // The browser can reach localhost, but the Cloudflare Worker cannot
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
    h1 { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 600; }
    p { margin: 0; color: #a89f8f; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card" id="c"></div>
  <script>
    (async () => {
      const c = document.getElementById('c');
      const logo = '<img src="https://sniff.to/logo.png" alt="Sniff" style="height:32px;margin-bottom:1.5rem" onerror="this.style.display=\\'none\\'" />';
      try {
        const r = await fetch('${callbackUrl}/oauth/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'linear', tokens: ${JSON.stringify(tokens)} }) });
        c.innerHTML = r.ok
          ? logo + '<div class="icon icon-ok"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div><h1>Done</h1><p>You can close this window.</p>'
          : logo + '<div class="icon icon-err"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></div><h1>Failed</h1><p>CLI returned an error.</p>';
      } catch (e) {
        c.innerHTML = logo + '<div class="icon icon-err"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></div><h1>Failed</h1><p>Could not reach CLI. Is it running?</p>';
      }
    })();
  </script>
</body>
</html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      },
    )
  } catch (error) {
    return new Response(`OAuth error: ${error}`, { status: 500 })
  }
}

/**
 * Handle token refresh
 */
export async function handleTokenRefresh(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json()
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
