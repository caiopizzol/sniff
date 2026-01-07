/**
 * Storage interfaces for Sniff
 * All storage is filesystem-based in ~/.sniff/
 */

export interface OAuth2Tokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  tokenType?: string
  scope?: string
  organizationId?: string
}

/**
 * User credentials for proxy-managed token architecture
 * The proxy holds the org's agent token; CLI only stores user identity
 */
export interface UserCredentials {
  userId: string
  email: string
  name: string
  organizationId: string
  organizationName: string
}

export interface TokenStorage {
  /** Get tokens for a platform */
  get(platform: string): Promise<OAuth2Tokens | null>
  /** Set tokens for a platform */
  set(platform: string, tokens: OAuth2Tokens): Promise<void>
  /** Delete tokens for a platform */
  delete(platform: string): Promise<void>
  /** Check if tokens exist for a platform */
  has(platform: string): Promise<boolean>
}

export interface CredentialStorage {
  /** Get user credentials for a platform */
  get(platform: string): Promise<UserCredentials | null>
  /** Set user credentials for a platform */
  set(platform: string, credentials: UserCredentials): Promise<void>
  /** Delete credentials for a platform */
  delete(platform: string): Promise<void>
  /** Check if credentials exist for a platform */
  has(platform: string): Promise<boolean>
}

export interface ConfigStorage {
  /** Get the current configuration */
  get(): Promise<unknown | null>
  /** Set the configuration */
  set(config: unknown): Promise<void>
  /** Check if configuration exists */
  exists(): Promise<boolean>
}

export interface LogEntry {
  timestamp: Date
  runId: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  metadata?: Record<string, unknown>
}

export interface LogFilter {
  runId?: string
  level?: LogEntry['level']
  since?: Date
  until?: Date
  limit?: number
}

export interface LogStorage {
  /** Append a log entry */
  append(entry: LogEntry): Promise<void>
  /** List log entries with optional filter */
  list(filter?: LogFilter): Promise<LogEntry[]>
  /** Clear logs older than a date */
  clear(olderThan: Date): Promise<number>
}
