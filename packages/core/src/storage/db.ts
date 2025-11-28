/**
 * PostgreSQL database connection and initialization
 */

import { Pool, type PoolClient } from 'pg';

// Shared connection pool
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/**
 * Initialize database tables
 */
async function createTables(client: PoolClient): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // Tokens table for OAuth
  await client.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Config table for deployed agent configurations
  await client.query(`
    CREATE TABLE IF NOT EXISTS config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      yaml_content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

let initialized = false;

/**
 * Initialize the database (creates tables if they don't exist)
 */
export async function initDatabase(): Promise<void> {
  if (initialized) return;

  const client = await getPool().connect();
  try {
    await createTables(client);
    initialized = true;
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

/**
 * Close the database connection pool
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    initialized = false;
  }
}
