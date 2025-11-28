/**
 * OAuth2 Auth Endpoints
 *
 * Handles the OAuth2 flow for Linear authentication.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { auth } from '@usepolvo/core';
import { randomBytes } from 'node:crypto';

type OAuth2Auth = ReturnType<typeof auth.oauth2>;

// Temporary storage for PKCE code verifiers and state
// In production, consider using a proper session store
const pendingAuth = new Map<string, { codeVerifier?: string; expiresAt: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingAuth) {
    if (value.expiresAt < now) {
      pendingAuth.delete(key);
    }
  }
}, 60 * 1000);

export interface AuthEndpointsConfig {
  oauth: OAuth2Auth;
  onSuccess?: () => void;
}

/**
 * Handle OAuth2 authorization request
 * Redirects user to Linear authorization page
 */
export function handleAuthStart(
  _req: IncomingMessage,
  res: ServerResponse,
  config: AuthEndpointsConfig,
): void {
  const state = randomBytes(16).toString('hex');
  const { url, codeVerifier } = config.oauth.getAuthorizationUrl(state);

  // Store state and code verifier for callback
  pendingAuth.set(state, {
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  res.writeHead(302, { Location: url });
  res.end();
}

/**
 * Handle OAuth2 callback
 * Exchanges code for tokens and stores them
 */
export async function handleAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  config: AuthEndpointsConfig,
): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
    return;
  }

  if (!code || !state) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Missing code or state</h1>');
    return;
  }

  const pending = pendingAuth.get(state);
  if (!pending) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Invalid or expired state</h1>');
    return;
  }

  pendingAuth.delete(state);

  try {
    await config.oauth.exchangeCode(code, pending.codeVerifier);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Authorization successful!</h1><p>You can close this window.</p>');

    config.onSuccess?.();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Token exchange failed</h1><p>${message}</p>`);
  }
}
