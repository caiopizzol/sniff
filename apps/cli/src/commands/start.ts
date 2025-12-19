/**
 * start command - Start the local agent server
 */

import { loadConfig } from '@sniff/config'
import { getEnvConfig, logger, setLogLevel } from '@sniff/core'
import {
  LinearClient,
  needsRefresh,
  parseAgentSessionEvent,
  parseWebhook,
  refreshLinearTokens,
  verifyWebhookSignature,
} from '@sniff/linear'
import { Coordinator, LocalServer, WorktreeManager } from '@sniff/orchestrator'
import { createClaudeRunner } from '@sniff/runner-claude'
import { ensureDirectories, tokenStorage } from '@sniff/storage'
import { Command } from 'commander'

export const startCommand = new Command('start')
  .description('Start the local agent server')
  .option('-c, --config <path>', 'Path to config file', 'sniff.yml')
  .option('-p, --port <number>', 'Local server port')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    if (options.verbose) {
      setLogLevel('debug')
    }

    await ensureDirectories()

    // Get env config
    const env = getEnvConfig()

    // Load agent config
    let config
    try {
      config = await loadConfig({ path: options.config })
    } catch (error) {
      console.error('Failed to load config:', error instanceof Error ? error.message : error)
      process.exit(1)
    }

    // Check authentication
    let tokens = await tokenStorage.get('linear')
    if (!tokens) {
      console.error('Not authenticated with Linear. Run: sniff auth linear')
      process.exit(1)
    }

    // Track if using local tokens (for saving refreshed tokens to correct location)
    const isLocalToken = await tokenStorage.hasLocal('linear')

    // Refresh token if expired or expiring soon
    if (needsRefresh(tokens)) {
      try {
        logger.info('Refreshing expired Linear token...')
        tokens = await refreshLinearTokens(tokens, env.proxyUrl)
        if (isLocalToken) {
          await tokenStorage.setLocal('linear', tokens)
        } else {
          await tokenStorage.set('linear', tokens)
        }
        logger.info('Token refreshed successfully')
      } catch (error) {
        logger.warn('Token refresh failed, continuing with existing token', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Create Linear client
    const linearClient = new LinearClient({ accessToken: tokens.accessToken })

    // Create runner and coordinator
    const runner = createClaudeRunner()
    const worktreeManager = new WorktreeManager()
    const coordinator = new Coordinator({
      config,
      runner,
      worktreeManager,
      repositoryPath: process.cwd(),
      linearAccessToken: tokens.accessToken,
    })

    const port = options.port ? parseInt(options.port, 10) : env.port

    // Create local server
    const server = new LocalServer({
      port,
      onWebhook: async (request) => {
        try {
          const body = await request.text()

          // Verify signature if webhook secret is set
          const signature = request.headers.get('linear-signature')
          if (env.linearWebhookSecret && signature) {
            if (!verifyWebhookSignature(body, signature, env.linearWebhookSecret)) {
              return new Response('Invalid signature', { status: 401 })
            }
          }

          const payload = JSON.parse(body)

          logger.debug('Raw webhook payload', { payload: JSON.stringify(payload, null, 2) })

          logger.info('Webhook received', {
            type: payload.type,
            action: payload.action,
          })

          // Handle AgentSessionEvent (Linear Agents API)
          const agentSessionEvent = parseAgentSessionEvent(payload)
          if (agentSessionEvent) {
            logger.info('Agent session event', {
              sessionId: agentSessionEvent.sessionId,
              issueIdentifier: agentSessionEvent.issue.identifier,
              action: agentSessionEvent.action,
            })

            // Process async - don't await, return immediately
            // This ensures we respond within 5s as required by Linear
            coordinator.handleAgentSession(agentSessionEvent, linearClient).catch((error) => {
              logger.error('Agent session handling failed', {
                error: error instanceof Error ? error.message : String(error),
              })
            })

            return new Response('OK', { status: 200 })
          }

          // Handle legacy Issue webhooks
          const issueEvent = parseWebhook(payload)
          if (issueEvent) {
            logger.info('Issue event', {
              action: issueEvent.action,
              issueId: issueEvent.data.issueId,
              labels: issueEvent.data.labels,
            })

            // Process async
            coordinator.handleWebhook(issueEvent).catch((error) => {
              logger.error('Webhook handling failed', {
                error: error instanceof Error ? error.message : String(error),
              })
            })

            return new Response('OK', { status: 200 })
          }

          logger.debug('Ignoring webhook', { type: payload.type })
          return new Response('OK', { status: 200 })
        } catch (error) {
          logger.error('Webhook error', {
            error: error instanceof Error ? error.message : String(error),
          })
          return new Response('Internal error', { status: 500 })
        }
      },
    })

    // Start server
    server.start()
    console.log(`Local server started on http://localhost:${port}`)
    console.log('')
    console.log('Start your tunnel manually (e.g., ngrok http ' + port + ')')
    console.log('Then set TUNNEL_URL in apps/proxy/.env')
    console.log('')
    console.log('Waiting for webhooks...')
    console.log('Press Ctrl+C to stop')

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('')
      console.log('Stopping...')
      server.stop()
      process.exit(0)
    })
  })
