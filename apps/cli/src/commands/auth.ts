/**
 * auth command - Authenticate with platforms via OAuth
 */

import { getEnvConfig } from '@sniff/core'
import { LocalServer, type OAuthTokens } from '@sniff/orchestrator'
import { ensureDirectories, tokenStorage } from '@sniff/storage'
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
    if (!options.force && (await tokenStorage.has('linear'))) {
      console.log('Already authenticated with Linear')
      console.log('Use --force to re-authenticate')
      return
    }

    // Get env config
    const env = getEnvConfig()
    const proxyUrl = env.proxyUrl

    if (!proxyUrl) {
      console.error('SNIFF_PROXY_URL is not set.')
      console.error('Set it in your .env file or environment:')
      console.error('  export SNIFF_PROXY_URL=https://your-proxy.workers.dev')
      process.exit(1)
    }

    const port = options.port ? parseInt(options.port, 10) : env.port

    console.log('Linear OAuth Authentication')
    console.log('')
    console.log('Starting local callback server...')

    // Create a promise that resolves when we receive tokens
    let resolveTokens: (tokens: OAuthTokens) => void
    const tokensPromise = new Promise<OAuthTokens>((resolve) => {
      resolveTokens = resolve
    })

    // Start local server to receive OAuth callback
    const server = new LocalServer({
      port,
      onOAuthCallback: async (callbackPlatform, tokens) => {
        if (callbackPlatform === 'linear') {
          resolveTokens(tokens)
          return new Response('OK', { status: 200 })
        }
        return new Response('Unknown platform', { status: 400 })
      },
    })

    server.start()

    // Build OAuth URL with local callback
    // Note: The proxy will try to POST tokens to this URL
    // If it fails (e.g., no tunnel), user can copy the token manually
    const callbackUrl = `http://localhost:${port}`
    const authUrl = `${proxyUrl}/auth/linear?callback=${encodeURIComponent(callbackUrl)}`

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

    try {
      const tokens = await tokensPromise
      await storeTokens(tokens)
      console.log('')
      console.log('[OK] Successfully authenticated with Linear!')
    } catch (error) {
      console.error('')
      console.error('[X] Authentication failed:', error instanceof Error ? error.message : error)
      server.stop()
      process.exit(1)
    }

    server.stop()
    process.exit(0)
  })

async function storeTokens(tokens: OAuthTokens) {
  await tokenStorage.set('linear', {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
  })
}
