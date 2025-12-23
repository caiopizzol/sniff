/**
 * start command - Start the agent and connect to the cloud proxy
 */

import { loadConfig } from '@sniff/config'
import { ConnectionClient } from '@sniff/connection'
import { getEnvConfig, logger, setLogLevel } from '@sniff/core'
import {
  LinearClient,
  needsRefresh,
  parseAgentSessionEvent,
  parseWebhook,
  refreshLinearTokens,
  verifyWebhookSignature,
} from '@sniff/linear'
import { Coordinator, WorktreeManager } from '@sniff/orchestrator'
import { createClaudeRunner } from '@sniff/runner-claude'
import { ensureDirectories, tokenStorage } from '@sniff/storage'
import { Command } from 'commander'

export const startCommand = new Command('start')
  .description('Start the agent and connect to the cloud proxy')
  .option('-c, --config <path>', 'Path to config file', 'sniff.yml')
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

    if (!tokens.organizationId) {
      console.error('Missing organization ID. Please re-authenticate: sniff auth linear --force')
      process.exit(1)
    }

    const organizationId = tokens.organizationId

    // Track if using local tokens (for saving refreshed tokens to correct location)
    const isLocalToken = await tokenStorage.hasLocal('linear')

    // Refresh token if expired or expiring soon
    if (needsRefresh(tokens)) {
      try {
        logger.info('Refreshing expired Linear token...')
        const refreshedTokens = await refreshLinearTokens(tokens, env.proxyUrl)
        tokens = { ...refreshedTokens, organizationId: tokens.organizationId }
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

    // Handle webhook received via WebSocket
    const handleWebhook = async (body: string, headers: Record<string, string>) => {
      try {
        // Verify signature if webhook secret is set
        const signature = headers['linear-signature']
        if (env.linearWebhookSecret && signature) {
          if (!verifyWebhookSignature(body, signature, env.linearWebhookSecret)) {
            logger.warn('Invalid webhook signature')
            return
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

          coordinator.handleAgentSession(agentSessionEvent, linearClient).catch((error) => {
            logger.error('Agent session handling failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
          return
        }

        // Handle legacy Issue webhooks
        const issueEvent = parseWebhook(payload)
        if (issueEvent) {
          logger.info('Issue event', {
            action: issueEvent.action,
            issueId: issueEvent.data.issueId,
            labels: issueEvent.data.labels,
          })

          coordinator.handleWebhook(issueEvent).catch((error) => {
            logger.error('Webhook handling failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
          return
        }

        logger.debug('Ignoring webhook', { type: payload.type })
      } catch (error) {
        logger.error('Webhook error', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Create WebSocket connection to proxy
    const connection = new ConnectionClient({
      proxyUrl: env.proxyUrl,
      organizationId,
      accessToken: tokens.accessToken,
      onWebhook: handleWebhook,
      onConnected: () => {
        console.log('')
        console.log('Connected to proxy')
        console.log('Sniffing for webhooks...')
      },
      onDisconnected: () => {
        console.log('Disconnected from proxy, reconnecting...')
      },
      onError: (error) => {
        logger.error('Connection error', { error: error.message })
      },
    })

    console.log(`Connecting to ${env.proxyUrl}...`)

    try {
      await connection.connect()
    } catch (error) {
      console.error('Failed to connect:', error instanceof Error ? error.message : error)
      process.exit(1)
    }

    console.log('Press Ctrl+C to stop')

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('')
      console.log('Stopping...')
      connection.disconnect()
      process.exit(0)
    })
  })
