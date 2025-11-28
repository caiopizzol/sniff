/**
 * PostgreSQL storage for OAuth2 tokens
 */

import { getPool, initDatabase } from './db.js';

/**
 * OAuth2 token data
 */
export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Interface for token storage (compatible with Polvo's TokenStorage)
 */
export interface TokenStorage {
  get(): Promise<OAuth2Tokens | null>;
  set(tokens: OAuth2Tokens): Promise<void>;
  clear(): Promise<void>;
}

/**
 * PostgreSQL-backed token storage
 */
export class PostgresTokenStorage implements TokenStorage {
  private id: string | undefined;

  constructor(id?: string) {
    this.id = id;
  }

  getId(): string | undefined {
    return this.id;
  }

  async get(): Promise<OAuth2Tokens | null> {
    if (!this.id) return null;

    await initDatabase();
    const client = await getPool().connect();
    try {
      const result = await client.query(
        'SELECT access_token, refresh_token, expires_at FROM tokens WHERE id = $1',
        [this.id],
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        accessToken: row.access_token,
        refreshToken: row.refresh_token || undefined,
        expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
      };
    } finally {
      client.release();
    }
  }

  async set(tokens: OAuth2Tokens): Promise<void> {
    await initDatabase();
    const client = await getPool().connect();
    try {
      if (this.id) {
        // Update existing token
        await client.query(
          `
          UPDATE tokens SET
            access_token = $2,
            refresh_token = $3,
            expires_at = $4,
            updated_at = NOW()
          WHERE id = $1
          `,
          [this.id, tokens.accessToken, tokens.refreshToken || null, tokens.expiresAt || null],
        );
      } else {
        // Insert new token with generated UUID
        const result = await client.query(
          `
          INSERT INTO tokens (access_token, refresh_token, expires_at, updated_at)
          VALUES ($1, $2, $3, NOW())
          RETURNING id
          `,
          [tokens.accessToken, tokens.refreshToken || null, tokens.expiresAt || null],
        );
        this.id = result.rows[0].id;
      }
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    if (!this.id) return;

    await initDatabase();
    const client = await getPool().connect();
    try {
      await client.query('DELETE FROM tokens WHERE id = $1', [this.id]);
      this.id = undefined;
    } finally {
      client.release();
    }
  }

  close(): void {
    // No-op for PostgreSQL (pool is shared)
  }
}

/**
 * Create a PostgreSQL token storage instance
 */
export function createTokenStorage(id?: string): PostgresTokenStorage {
  return new PostgresTokenStorage(id);
}

/**
 * Clear all tokens (for OAuth revocation webhook in single-tenant mode)
 */
export async function clearAllTokens(): Promise<void> {
  await initDatabase();
  const client = await getPool().connect();
  try {
    await client.query('DELETE FROM tokens');
  } finally {
    client.release();
  }
}

/**
 * Check if any token exists (for auth status polling)
 */
export async function hasToken(): Promise<boolean> {
  await initDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT 1 FROM tokens LIMIT 1');
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Get the first available token (for single-tenant mode)
 */
export async function getFirstToken(): Promise<OAuth2Tokens | null> {
  await initDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      'SELECT access_token, refresh_token, expires_at FROM tokens LIMIT 1',
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token || undefined,
      expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
    };
  } finally {
    client.release();
  }
}

// Re-export database utilities and config storage
export { initDatabase, closeDatabase } from './db.js';
export { createConfigStorage, getConfig, setConfig, type ConfigStorage } from './config.js';
