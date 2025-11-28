/**
 * PostgreSQL config storage for deployed agent configurations
 */

import { getPool, initDatabase } from './db.js';

// Fixed UUID for default config (single-tenant)
const DEFAULT_CONFIG_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Interface for config storage
 */
export interface ConfigStorage {
  get(): Promise<string | null>;
  set(yaml: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

/**
 * PostgreSQL-backed config storage
 */
export class PostgresConfigStorage implements ConfigStorage {
  private id: string;

  constructor(id: string = DEFAULT_CONFIG_ID) {
    this.id = id;
  }

  async get(): Promise<string | null> {
    await initDatabase();
    const client = await getPool().connect();
    try {
      const result = await client.query('SELECT yaml_content FROM config WHERE id = $1', [this.id]);

      if (result.rows.length === 0) return null;
      return result.rows[0].yaml_content;
    } finally {
      client.release();
    }
  }

  async set(yaml: string): Promise<void> {
    await initDatabase();
    const client = await getPool().connect();
    try {
      await client.query(
        `
        INSERT INTO config (id, yaml_content, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (id) DO UPDATE SET
          yaml_content = EXCLUDED.yaml_content,
          updated_at = NOW()
        `,
        [this.id, yaml],
      );
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    await initDatabase();
    const client = await getPool().connect();
    try {
      await client.query('DELETE FROM config WHERE id = $1', [this.id]);
    } finally {
      client.release();
    }
  }

  close(): void {
    // No-op for PostgreSQL (pool is shared)
  }
}

/**
 * Create a PostgreSQL config storage instance
 */
export function createConfigStorage(id?: string): PostgresConfigStorage {
  return new PostgresConfigStorage(id);
}
