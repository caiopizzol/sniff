/**
 * Environment configuration
 *
 * All environment-specific settings come from env vars.
 * This keeps sniff.yml focused on agent definitions only.
 */

/** Default proxy URL for users not self-hosting */
const DEFAULT_PROXY_URL = 'https://proxy.sniff.to'

export interface EnvConfig {
  /** Proxy URL for OAuth and webhook forwarding */
  proxyUrl: string
  /** Local server port */
  port: number
  /** Linear webhook secret for signature verification */
  linearWebhookSecret?: string
  /** Whether worktrees are enabled */
  worktreeEnabled: boolean
}

/**
 * Get environment configuration with defaults
 */
export function getEnvConfig(): EnvConfig {
  return {
    proxyUrl: process.env.SNIFF_PROXY_URL || DEFAULT_PROXY_URL,
    port: parseInt(process.env.SNIFF_PORT || '3847', 10),
    linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
    worktreeEnabled: process.env.SNIFF_WORKTREE_ENABLED !== 'false',
  }
}

/**
 * Validate required environment variables
 */
export function validateEnv(required: (keyof EnvConfig)[]): string[] {
  const config = getEnvConfig()
  const missing: string[] = []

  for (const key of required) {
    if (config[key] === undefined || config[key] === '') {
      const envVar = envVarName(key)
      missing.push(envVar)
    }
  }

  return missing
}

/**
 * Map config key to env var name
 */
function envVarName(key: keyof EnvConfig): string {
  const map: Record<keyof EnvConfig, string> = {
    proxyUrl: 'SNIFF_PROXY_URL',
    port: 'SNIFF_PORT',
    linearWebhookSecret: 'LINEAR_WEBHOOK_SECRET',
    worktreeEnabled: 'SNIFF_WORKTREE_ENABLED',
  }
  return map[key]
}
