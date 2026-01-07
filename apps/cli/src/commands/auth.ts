/**
 * auth command - Authenticate with Linear via OAuth
 *
 * New architecture:
 * - User runs `sniff auth linear`
 * - CLI opens browser to proxy OAuth endpoint
 * - Proxy handles all OAuth logic:
 *   - User authentication
 *   - Admin detection
 *   - Org setup (actor=app OAuth) if admin and org not configured
 *   - User registration if org already configured
 * - Proxy POSTs result (user info, not tokens) to CLI
 * - CLI stores user credentials
 */

import { getEnvConfig } from '@sniff/core'
import { LocalServer, type AuthResult } from '@sniff/orchestrator'
import { credentialStorage, ensureDirectories, ensureLocalDirectories } from '@sniff/storage'
import { Command } from 'commander'

export const authCommand = new Command('auth')
  .description('Authenticate with platforms')
  .argument('<platform>', 'Platform to authenticate with (linear)')
  .option('-f, --force', 'Force re-authentication')
  .option('-p, --port <number>', 'Local callback port')
  .action(async (platform, options) => {
    await ensureDirectories()

    if (platform !== 'linear') {
      console.error(`Unknown platform: ${platform}`)
      console.error('Supported platforms: linear')
      process.exit(1)
    }

    // Check if already authenticated
    if (!options.force && (await credentialStorage.has('linear'))) {
      const creds = await credentialStorage.get('linear')
      console.log(`Already authenticated with Linear (${creds?.organizationName})`)
      console.log('Use --force to re-authenticate')
      return
    }

    // Get env config
    const env = getEnvConfig()
    const port = options.port ? parseInt(options.port, 10) : env.port

    console.log('Linear Authentication')
    console.log('')
    console.log('Starting local callback server...')

    // Create a promise that resolves when we receive auth result
    let resolveResult: (result: AuthResult) => void
    const resultPromise = new Promise<AuthResult>((resolve) => {
      resolveResult = resolve
    })

    // Start local server to receive auth result from proxy
    const server = new LocalServer({
      port,
      onAuthResult: async (callbackPlatform, result) => {
        if (callbackPlatform === 'linear') {
          resolveResult(result)
          return new Response('OK', { status: 200 })
        }
        return new Response('Unknown platform', { status: 400 })
      },
    })

    const actualPort = server.start()

    // Build OAuth URL with local callback
    const callbackUrl = `http://localhost:${actualPort}/auth/result`
    const authUrl = `${env.proxyUrl}/auth/linear?callback=${encodeURIComponent(callbackUrl)}`

    console.log('')
    console.log('Opening browser for authentication...')
    console.log('')
    console.log('If the browser does not open, visit:')
    console.log(`  ${authUrl}`)
    console.log('')

    // Open browser
    const openCommand =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'

    try {
      Bun.spawn([openCommand, authUrl], { stdout: 'ignore', stderr: 'ignore' })
    } catch {
      // Browser open failed, user can use the printed URL
    }

    console.log('Waiting for authentication...')

    // Timeout after 60 seconds (admin flow may take longer)
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 60000)
    })

    try {
      const result = await Promise.race([resultPromise, timeout])

      if (result.success) {
        // Store user credentials (not tokens!)
        const credentials = {
          userId: result.userId!,
          email: result.email!,
          name: result.name!,
          organizationId: result.organizationId!,
          organizationName: result.organizationName!,
        }

        // Store in same location as any existing credentials
        const storeLocally = await credentialStorage.hasLocal('linear')

        if (storeLocally) {
          await ensureLocalDirectories()
          await credentialStorage.setLocal('linear', credentials)
        } else {
          await credentialStorage.set('linear', credentials)
        }

        console.log('')
        if (result.action === 'configured') {
          // Admin just set up the org
          console.log(`[OK] Organization "${result.organizationName}" configured!`)
          console.log('Your team can now run `sniff auth linear` to join.')
        } else {
          // User joined existing org
          console.log(`[OK] Connected to "${result.organizationName}"!`)
          console.log(`Authenticated as ${result.name} (${result.email})`)
        }
        console.log('')
        console.log('Run `sniff start` to begin.')
      } else {
        // Error from proxy
        console.error('')
        if (result.error === 'org_not_configured') {
          console.error('[X] Organization not configured with Sniff.')
          console.error('    Ask a workspace admin to run `sniff auth linear` first.')
        } else {
          console.error(`[X] Authentication failed: ${result.message || result.error}`)
        }
        server.stop()
        process.exit(1)
      }
    } catch (error) {
      console.error('')
      if (error instanceof Error && error.message === 'timeout') {
        console.error('[X] Authentication timed out. Please try again.')
      } else {
        console.error('[X] Authentication failed:', error instanceof Error ? error.message : error)
      }
      server.stop()
      process.exit(1)
    }

    server.stop()
    process.exit(0)
  })
