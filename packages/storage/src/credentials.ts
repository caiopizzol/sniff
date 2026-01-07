/**
 * Credential storage implementation
 * Stores user identity (userId, email, orgId) instead of OAuth tokens
 * Used with the proxy-managed token architecture
 */

import type { CredentialStorage, UserCredentials } from '@sniff/core'
import { getLocalTokenPath, getTokenPath } from './paths'

export class FileCredentialStorage implements CredentialStorage {
  /**
   * Get credentials for a platform.
   * Checks local (./.sniff/) first, then global (~/.sniff/).
   */
  async get(platform: string): Promise<UserCredentials | null> {
    // Check local first
    const localPath = getLocalTokenPath(platform)
    const localFile = Bun.file(localPath)
    if (await localFile.exists()) {
      try {
        return await localFile.json()
      } catch {
        // Fall through to global
      }
    }

    // Fall back to global
    const globalPath = getTokenPath(platform)
    try {
      const file = Bun.file(globalPath)
      if (!(await file.exists())) {
        return null
      }
      return await file.json()
    } catch {
      return null
    }
  }

  /**
   * Store credentials globally (~/.sniff/).
   */
  async set(platform: string, credentials: UserCredentials): Promise<void> {
    const path = getTokenPath(platform)
    await Bun.write(path, JSON.stringify(credentials, null, 2))
  }

  /**
   * Store credentials locally (./.sniff/).
   */
  async setLocal(platform: string, credentials: UserCredentials): Promise<void> {
    const path = getLocalTokenPath(platform)
    await Bun.write(path, JSON.stringify(credentials, null, 2))
  }

  async delete(platform: string): Promise<void> {
    const path = getTokenPath(platform)
    const { unlink } = await import('node:fs/promises')

    try {
      await unlink(path)
    } catch {
      // File doesn't exist, ignore
    }
  }

  /**
   * Check if credentials exist (local or global).
   */
  async has(platform: string): Promise<boolean> {
    const localPath = getLocalTokenPath(platform)
    const localFile = Bun.file(localPath)
    if (await localFile.exists()) {
      return true
    }

    const globalPath = getTokenPath(platform)
    const globalFile = Bun.file(globalPath)
    return globalFile.exists()
  }

  /**
   * Check if local credentials exist for a platform.
   */
  async hasLocal(platform: string): Promise<boolean> {
    const localPath = getLocalTokenPath(platform)
    const file = Bun.file(localPath)
    return file.exists()
  }
}

/** Default credential storage instance */
export const credentialStorage = new FileCredentialStorage()
