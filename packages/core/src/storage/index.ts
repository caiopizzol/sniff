/**
 * Token storage for OAuth2
 *
 * Implements Polvo's TokenStorage interface with SQLite backend.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

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
 * Get or create the SQLite database
 */
function getDatabase(dbPath?: string): Database.Database {
  const defaultPath = join(homedir(), '.sniff', 'data.db');
  const path = dbPath || defaultPath;

  mkdirSync(join(homedir(), '.sniff'), { recursive: true });

  const db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      key TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER
    )
  `);

  return db;
}

/**
 * SQLite-backed token storage
 */
export class SQLiteTokenStorage implements TokenStorage {
  private db: Database.Database;
  private key: string;

  constructor(dbPath?: string, key: string = 'linear') {
    this.db = getDatabase(dbPath);
    this.key = key;
  }

  async get(): Promise<OAuth2Tokens | null> {
    const row = this.db
      .prepare('SELECT access_token, refresh_token, expires_at FROM tokens WHERE key = ?')
      .get(this.key) as
      | { access_token: string; refresh_token: string | null; expires_at: number | null }
      | undefined;

    if (!row) return null;

    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token || undefined,
      expiresAt: row.expires_at || undefined,
    };
  }

  async set(tokens: OAuth2Tokens): Promise<void> {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO tokens (key, access_token, refresh_token, expires_at)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(this.key, tokens.accessToken, tokens.refreshToken || null, tokens.expiresAt || null);
  }

  async clear(): Promise<void> {
    this.db.prepare('DELETE FROM tokens WHERE key = ?').run(this.key);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Create a SQLite token storage instance
 */
export function createTokenStorage(dbPath?: string, key?: string): SQLiteTokenStorage {
  return new SQLiteTokenStorage(dbPath, key);
}
