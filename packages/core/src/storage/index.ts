/**
 * PostgreSQL storage for OAuth2 tokens
 */

import { getPool, initDatabase } from './db.js';

// Fixed UUID for Linear OAuth tokens (single-tenant)
const LINEAR_TOKEN_ID = '00000000-0000-0000-0000-000000000001';

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
  private id: string;

  constructor(id: string = LINEAR_TOKEN_ID) {
    this.id = id;
  }

  async get(): Promise<OAuth2Tokens | null> {
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
      await client.query(
        `
        INSERT INTO tokens (id, access_token, refresh_token, expires_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW()
        `,
        [this.id, tokens.accessToken, tokens.refreshToken || null, tokens.expiresAt || null],
      );
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    await initDatabase();
    const client = await getPool().connect();
    try {
      await client.query('DELETE FROM tokens WHERE id = $1', [this.id]);
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

// Re-export database utilities and config storage
export { initDatabase, closeDatabase } from './db.js';
export { createConfigStorage, type ConfigStorage } from './config.js';
