/**
 * Linear OAuth token utilities
 */

import type { OAuth2Tokens } from '@sniff/core'

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes

export function needsRefresh(tokens: OAuth2Tokens): boolean {
  if (!tokens.expiresAt || !tokens.refreshToken) return false
  return tokens.expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS
}

export async function refreshLinearTokens(
  tokens: OAuth2Tokens,
  proxyUrl: string,
): Promise<OAuth2Tokens> {
  if (!tokens.refreshToken) {
    throw new Error('No refresh token available')
  }

  const response = await fetch(`${proxyUrl}/auth/linear/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Token refresh failed: ${response.status}`)
  }

  const data = await response.json()

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    tokenType: data.token_type,
    scope: data.scope,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  }
}
