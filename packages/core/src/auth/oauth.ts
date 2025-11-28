/**
 * Linear OAuth2 Authentication
 *
 * Uses Polvo's OAuth2 support with Linear-specific configuration.
 */

import { auth } from '@usepolvo/core';
import { createTokenStorage } from '../storage/index.js';

type TokenStorage = Parameters<typeof auth.oauth2>[1];

// Linear OAuth2 endpoints
const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';

export interface LinearOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

/**
 * Create a Linear OAuth2 handler
 */
export function createLinearOAuth(config: LinearOAuthConfig, storage?: TokenStorage) {
  return auth.oauth2(
    {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationUrl: LINEAR_AUTH_URL,
      tokenUrl: LINEAR_TOKEN_URL,
      redirectUri: config.redirectUri,
      scopes: config.scopes ?? ['read', 'write', 'app:assignable', 'app:mentionable'],
      extraParams: { actor: 'app' },
    },
    storage ?? createTokenStorage(),
  );
}

export { createTokenStorage };
