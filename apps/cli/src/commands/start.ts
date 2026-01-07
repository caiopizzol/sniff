/**
 * start command - Start the agent and connect to the cloud proxy
 *
 * New architecture:
 * - CLI authenticates with userId (not access token)
 * - All Linear API calls go through the proxy
 * - Proxy uses org's agent token (from admin setup)
 */

import { loadConfig } from '@sniff/config'
import { ConnectionClient } from '@sniff/connection'
import { getEnvConfig, logger, setLogLevel } from '@sniff/core'
import {
  LinearClient,
  parseAgentSessionEvent,
  parseWebhook,
  verifyWebhookSignature,
} from '@sniff/linear'
import { Coordinator, WorktreeManager } from '@sniff/orchestrator'
import { createClaudeRunner } from '@sniff/runner-claude'
import { credentialStorage, ensureDirectories } from '@sniff/storage'
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

    // Check authentication - now uses credentials, not tokens
    const credentials = await credentialStorage.get('linear')
    if (!credentials) {
      console.error('Not authenticated with Linear. Run: sniff auth linear')
      process.exit(1)
    }

    const { userId, email, organizationId, organizationName, name } = credentials

    console.log(`Authenticated as ${name} (${email})`)
    console.log(`Organization: ${organizationName}`)
    console.log('')

    // Handle webhook received via WebSocket
    let linearClient: LinearClient

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
    // New: authenticate with userId instead of access token
    const connection = new ConnectionClient({
      proxyUrl: env.proxyUrl,
      organizationId,
      userId,
      email,
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

    // Create Linear client that uses proxy relay
    // All API calls go through the WebSocket connection
    linearClient = new LinearClient({ connection })

    // Create runner and coordinator
    const runner = createClaudeRunner()
    const worktreeManager = new WorktreeManager()
    const coordinator = new Coordinator({
      config,
      runner,
      worktreeManager,
      repositoryPath: process.cwd(),
    })

    console.log('Press Ctrl+C to stop')

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('')
      console.log('Stopping...')
      connection.disconnect()
      process.exit(0)
    })
  })
