/**
 * PostgreSQL config storage for deployed agent configurations
 */

import { getPool, initDatabase } from './db.js';

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
  private id: string | undefined;

  constructor(id?: string) {
    this.id = id;
  }

  async get(): Promise<string | null> {
    if (!this.id) return null;

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
      if (this.id) {
        await client.query(
          `UPDATE config SET yaml_content = $2, updated_at = NOW() WHERE id = $1`,
          [this.id, yaml],
        );
      } else {
        const result = await client.query(
          `INSERT INTO config (yaml_content, updated_at) VALUES ($1, NOW()) RETURNING id`,
          [yaml],
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
      await client.query('DELETE FROM config WHERE id = $1', [this.id]);
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
 * Create a PostgreSQL config storage instance
 */
export function createConfigStorage(id?: string): PostgresConfigStorage {
  return new PostgresConfigStorage(id);
}

/**
 * Get the current config (single-tenant)
 */
export async function getConfig(): Promise<string | null> {
  await initDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT yaml_content FROM config LIMIT 1');
    if (result.rows.length === 0) return null;
    return result.rows[0].yaml_content;
  } finally {
    client.release();
  }
}

/**
 * Set the config (single-tenant, replaces any existing)
 */
export async function setConfig(yaml: string): Promise<void> {
  await initDatabase();
  const client = await getPool().connect();
  try {
    // Clear existing and insert new
    await client.query('DELETE FROM config');
    await client.query(`INSERT INTO config (yaml_content, updated_at) VALUES ($1, NOW())`, [yaml]);
  } finally {
    client.release();
  }
}
