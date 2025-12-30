/**
 * Main orchestration logic
 */

import type { AgentConfig, ClaudeRunnerOptions, Config } from '@sniff/config'
import type { AgentRunEvent, LinearWebhookEvent, Runner, RunnerContext } from '@sniff/core'
import { logger } from '@sniff/core'
import {
  type AgentSessionEvent,
  type LinearClient,
  buildPromptFromSession,
  fetchAttachmentMetadata,
  fetchIssueRelations,
  formatAttachmentMessagesForPrompt,
  formatAttachmentsForPrompt,
  formatRelatedIssuesForPrompt,
  prefetchLinearAttachments,
} from '@sniff/linear'
import type { WorktreeManager } from './worktree'

export interface CoordinatorOptions {
  config: Config
  runner: Runner
  worktreeManager: WorktreeManager
  repositoryPath: string
  /** Linear OAuth access token for auto-injecting MCP */
  linearAccessToken?: string
}

export class Coordinator {
  private config: Config
  private runner: Runner
  private worktreeManager: WorktreeManager
  private repositoryPath: string
  private linearAccessToken?: string
  /** Track active sessions for stop handling */
  private activeSessions: Map<string, { runner: Runner }> = new Map()

  constructor(options: CoordinatorOptions) {
    this.config = options.config
    this.runner = options.runner
    this.worktreeManager = options.worktreeManager
    this.repositoryPath = options.repositoryPath
    this.linearAccessToken = options.linearAccessToken
  }

  /**
   * Stop a running session
   */
  async stopSession(sessionId: string, client: LinearClient): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (session) {
      logger.info('Stopping session', { sessionId })
      await session.runner.stop()
      this.activeSessions.delete(sessionId)
      await client.sendResponse(sessionId, 'Stopped as requested.')
    }
  }

  /**
   * Get runner options from agent config
   * Currently only supports Claude runner
   */
  private getRunnerOptions(agent: AgentConfig): ClaudeRunnerOptions | null {
    // Currently only Claude is supported
    return agent.runner.claude ?? null
  }

  /**
   * Build RunnerContext from agent config
   */
  private buildContext(agent: AgentConfig, workingDirectory: string): RunnerContext | null {
    const options = this.getRunnerOptions(agent)
    if (!options) {
      return null
    }

    // Auto-inject Linear MCP if not configured and we have an access token
    let mcpServers = options.mcpServers
    if (this.linearAccessToken && !mcpServers?.linear) {
      logger.debug('Auto-injecting Linear MCP with OAuth token')
      mcpServers = {
        ...mcpServers,
        linear: {
          type: 'sse' as const,
          url: 'https://mcp.linear.app/sse',
          headers: { Authorization: `Bearer ${this.linearAccessToken}` },
        },
      }
    }

    return {
      workingDirectory,
      systemPrompt: agent.systemPrompt,
      model: options.model,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      mcpServers,
      permissionMode: options.permissionMode ?? 'acceptEdits',
      maxTurns: options.maxTurns,
      env: options.env,
    }
  }

  /**
   * Handle an Agent Session event from Linear Agents API
   * This is triggered when the agent is mentioned or delegated an issue
   */
  async handleAgentSession(event: AgentSessionEvent, client: LinearClient): Promise<void> {
    const { sessionId, issue, signal } = event

    logger.info('Handling agent session', {
      sessionId,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      action: event.action,
      signal,
    })

    // Handle stop signal
    if (signal === 'stop') {
      logger.info('Stop signal received', { sessionId })
      await this.stopSession(sessionId, client)
      return
    }

    try {
      // 1. Send immediate thought activity (must be within 10s)
      await client.sendThought(sessionId, 'Sniffing out the issue...')

      // 2. Find matching agent based on issue labels and team
      const match = await this.findAgentForSession(issue.id, client)
      if (!match) {
        await client.sendError(sessionId, 'No matching agent found for this issue')
        return
      }
      const { agent } = match

      logger.info('Matched agent for session', {
        agentId: agent.id,
        label: agent.label,
        team: agent.team,
      })

      // 3. Create worktree for isolated execution
      let worktreePath: string
      try {
        await client.sendAction(sessionId, 'Preparing', 'the hunting grounds')
        worktreePath = await this.worktreeManager.create(issue.identifier, this.repositoryPath)
      } catch (error) {
        // If worktree creation fails, run in main repo
        logger.warn('Worktree creation failed, using main repository', {
          error: error instanceof Error ? error.message : String(error),
        })
        worktreePath = this.repositoryPath
      }

      // 4. Build context from agent config
      const context = this.buildContext(agent, worktreePath)
      if (!context) {
        await client.sendError(sessionId, 'No runner configured for agent')
        return
      }

      // 5. Pre-fetch Linear attachments, metadata, and relations if we have an access token
      let attachmentsContext = ''
      if (this.linearAccessToken) {
        try {
          // Fetch file attachments (PDFs, images, etc.)
          const attachments = await prefetchLinearAttachments(
            event,
            this.linearAccessToken,
            worktreePath,
          )
          attachmentsContext += formatAttachmentsForPrompt(attachments)

          // Fetch attachment metadata (Slack messages, customer requests, etc.)
          const metadata = await fetchAttachmentMetadata(event.issue.id, this.linearAccessToken)
          attachmentsContext += formatAttachmentMessagesForPrompt(metadata)

          // Fetch related issues (blocking, blocked-by, duplicates, etc.)
          const relations = await fetchIssueRelations(event.issue.id, this.linearAccessToken)
          attachmentsContext += formatRelatedIssuesForPrompt(relations)
        } catch (error) {
          logger.warn('Failed to pre-fetch attachments', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const message = buildPromptFromSession(event) + attachmentsContext

      logger.debug('Prompt sent to agent', { message })

      // 6. Run the agent with progress callback
      await client.sendThought(sessionId, 'Following the trail...')

      // Track session for stop handling
      this.activeSessions.set(sessionId, { runner: this.runner })

      try {
        const result = await this.runner.run(message, context, async (progress) => {
          logger.debug('Agent progress', { sessionId, progress })

          if (progress.type === 'tool_use') {
            const metadata = progress.metadata as Record<string, unknown> | undefined
            const toolName = (metadata?.tool as string) || progress.content
            const input = metadata?.input as Record<string, unknown> | undefined

            // Only show significant actions, hide routine exploration
            if (toolName === 'Task') {
              // Task spawns are milestones
              const description = (input?.description as string) || 'Running subtask'
              const subagentType = (input?.subagent_type as string) || ''
              await client.sendAction(sessionId, description, subagentType).catch((err) => {
                logger.warn('Failed to send action', { error: err })
              })
            } else if (toolName === 'Edit' || toolName === 'Write') {
              // File modifications are significant
              const filePath = input?.file_path as string | undefined
              const action = toolName === 'Edit' ? 'Editing' : 'Writing'
              await client.sendAction(sessionId, action, filePath ? this.shortenPath(filePath) : '').catch((err) => {
                logger.warn('Failed to send action', { error: err })
              })
            } else {
              // All other tools (Read, Glob, Grep, Bash) → just "Thinking..."
              await client.sendEphemeralThought(sessionId, 'Nose to the ground...').catch((err) => {
                logger.warn('Failed to send ephemeral thought', { error: err })
              })
            }
          } else if (progress.type === 'output') {
            // Agent output/reasoning → show as thought (the "why")
            if (progress.content && progress.content.length > 20) {
              await client.sendThought(sessionId, progress.content).catch((err) => {
                logger.warn('Failed to send thought', { error: err })
              })
            }
          } else if (progress.type === 'thinking') {
            // Extended thinking → ephemeral (internal)
            await client.sendEphemeralThought(sessionId, 'Nose to the ground...').catch((err) => {
              logger.warn('Failed to send ephemeral thought', { error: err })
            })
          }
        })

        // 7. Send final response or error
        if (result.success) {
          const response = result.output || 'Tracked it down.'
          await client.sendResponse(sessionId, response)
        } else {
          await client.sendError(sessionId, result.error || 'Unknown error occurred')
        }
      } finally {
        // Remove from active sessions
        this.activeSessions.delete(sessionId)
      }
    } catch (error) {
      logger.error('Agent session handling failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })

      // Try to send error to Linear
      try {
        await client.sendError(
          sessionId,
          `Processing failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      } catch {
        // Ignore if we can't even send the error
      }
    }
  }

  /**
   * Handle an incoming webhook event (legacy Issue-based)
   */
  async handleWebhook(event: LinearWebhookEvent): Promise<AgentRunEvent | null> {
    // Find agent matching the event's labels and team
    const agent = this.findAgentForWebhook(event)

    if (!agent) {
      logger.debug('No matching agent for webhook', {
        labels: event.data.labels,
        teamKey: event.data.teamKey,
      })
      return null
    }

    const runId = `${agent.id}-${event.data.issueId}-${Date.now()}`

    const runEvent: AgentRunEvent = {
      runId,
      agentId: agent.id,
      issueId: event.data.issueId,
      status: 'started',
      timestamp: new Date(),
    }

    try {
      // Create worktree for isolated execution
      const worktreePath = await this.worktreeManager.create(
        event.data.issueIdentifier,
        this.repositoryPath,
      )

      // Build context from agent config
      const context = this.buildContext(agent, worktreePath)
      if (!context) {
        runEvent.status = 'failed'
        runEvent.error = 'No runner configured for agent'
        return runEvent
      }

      // Build message from issue
      const message = this.buildMessage(event)

      logger.debug('Prompt sent to agent', { message })

      // Run the agent
      runEvent.status = 'running'
      const result = await this.runner.run(message, context)

      if (result.success) {
        runEvent.status = 'completed'
      } else {
        runEvent.status = 'failed'
        runEvent.error = result.error
      }
    } catch (error) {
      runEvent.status = 'failed'
      runEvent.error = error instanceof Error ? error.message : String(error)
    }

    return runEvent
  }

  /**
   * Find agent matching labels and/or team
   * - No filters: matches everything
   * - Label only: matches issues with that label
   * - Team only: matches issues in that team
   * - Both: matches issues with label AND in team
   */
  private findAgent(labels: string[], teamKey: string): AgentConfig | null {
    for (const agent of this.config.agents) {
      // If agent has label filter, check it matches
      if (agent.label && !labels.includes(agent.label)) {
        continue
      }

      // If agent has team filter, check it matches
      if (agent.team && agent.team !== teamKey) {
        continue
      }

      return agent
    }

    return null
  }

  /**
   * Find agent matching the webhook event's labels and team
   */
  private findAgentForWebhook(event: LinearWebhookEvent): AgentConfig | null {
    const { labels, teamKey } = event.data
    return this.findAgent(labels, teamKey)
  }

  /**
   * Fetch issue details from Linear and find matching agent
   */
  private async findAgentForSession(
    issueId: string,
    client: LinearClient,
  ): Promise<{ agent: AgentConfig; labels: string[]; teamKey: string } | null> {
    try {
      const issue = await client.getIssue(issueId)
      const labels = await issue.labels()
      const team = await issue.team

      const labelNames = labels.nodes.map((l) => l.name)
      const teamKey = team?.key ?? ''

      const agent = this.findAgent(labelNames, teamKey)
      if (agent) {
        return { agent, labels: labelNames, teamKey }
      }

      logger.debug('No matching agent for session', { labels: labelNames, teamKey })
      return null
    } catch (error) {
      logger.error('Failed to fetch issue for agent matching', {
        issueId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Build message from event
   */
  private buildMessage(event: LinearWebhookEvent): string {
    const { data } = event
    let message = `Issue: ${data.issueIdentifier} - ${data.issueTitle}\n\n`

    if (data.issueDescription) {
      message += `Description:\n${data.issueDescription}\n\n`
    }

    if (data.labels.length > 0) {
      message += `Labels: ${data.labels.join(', ')}\n`
    }

    return message
  }

  /**
   * Shorten a file path for display (show last 2-3 segments)
   */
  private shortenPath(filePath: string): string {
    const segments = filePath.split('/')
    if (segments.length <= 3) return filePath
    return '.../' + segments.slice(-3).join('/')
  }
}
