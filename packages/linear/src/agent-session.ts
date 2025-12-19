/**
 * Linear Agent Session types and parsing
 *
 * Handles AgentSessionEvent webhooks from Linear's Agents API.
 * See: https://linear.app/developers/agent-interaction
 */

import { logger } from '@sniff/core'

/**
 * Issue data from agent session
 */
export interface AgentSessionIssue {
  id: string
  identifier: string
  title: string
  description?: string
  teamId: string
}

/**
 * Comment data from agent session
 */
export interface AgentSessionComment {
  id: string
  body: string
  userId: string
}

/**
 * Previous comment in thread
 */
export interface PreviousComment {
  body: string
  userId: string
  issueId: string
}

/**
 * Agent session from webhook payload
 */
export interface AgentSession {
  id: string
  issue: AgentSessionIssue
  comment?: AgentSessionComment
}

/**
 * Agent activity from prompted webhooks
 */
export interface AgentActivity {
  id: string
  content: {
    type: string
    body?: string
  }
  signal?: 'stop' | 'auth' | 'select'
}

/**
 * AgentSessionEvent webhook payload
 */
export interface AgentSessionPayload {
  type: 'AgentSessionEvent'
  action: 'created' | 'prompted'
  agentSession: AgentSession
  agentActivity?: AgentActivity
  previousComments: PreviousComment[]
  guidance: string | null
  promptContext: string
  webhookTimestamp: number
  webhookId: string
}

/**
 * Parsed agent session event
 */
export interface AgentSessionEvent {
  sessionId: string
  action: 'created' | 'prompted'
  issue: AgentSessionIssue
  comment?: AgentSessionComment
  previousComments: PreviousComment[]
  guidance: string | null
  promptContext: string
  /** Signal from user (e.g., 'stop' to halt work) */
  signal?: 'stop' | 'auth' | 'select'
  /** Prompt body from user (for prompted action) */
  promptBody?: string
}

/**
 * Activity content types for sending to Linear
 */
export type ThoughtContent = {
  type: 'thought'
  body: string
}

export type ActionContent = {
  type: 'action'
  action: string
  parameter: string
  result?: string
}

export type ResponseContent = {
  type: 'response'
  body: string
}

export type ErrorContent = {
  type: 'error'
  body: string
}

export type ElicitationContent = {
  type: 'elicitation'
  body: string
}

export type ActivityContent =
  | ThoughtContent
  | ActionContent
  | ResponseContent
  | ErrorContent
  | ElicitationContent

/**
 * Parse AgentSessionEvent webhook payload
 * Returns null if payload is not an AgentSessionEvent
 */
export function parseAgentSessionEvent(payload: unknown): AgentSessionEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const p = payload as Record<string, unknown>

  if (p.type !== 'AgentSessionEvent') {
    return null
  }

  const action = p.action as string
  if (action !== 'created' && action !== 'prompted') {
    return null
  }

  const agentSession = p.agentSession as AgentSession | undefined
  if (!agentSession?.id || !agentSession?.issue) {
    return null
  }

  // Extract signal and prompt body from agentActivity (for prompted action)
  const agentActivity = p.agentActivity as AgentActivity | undefined
  const signal = agentActivity?.signal
  const promptBody = agentActivity?.content?.body

  const event: AgentSessionEvent = {
    sessionId: agentSession.id,
    action: action as 'created' | 'prompted',
    issue: agentSession.issue,
    comment: agentSession.comment,
    previousComments: (p.previousComments as PreviousComment[]) || [],
    guidance: (p.guidance as string) || null,
    promptContext: (p.promptContext as string) || '',
    signal,
    promptBody,
  }

  logger.debug('Parsed AgentSessionEvent', {
    sessionId: event.sessionId,
    action: event.action,
    issue: event.issue,
    comment: event.comment,
    previousComments: event.previousComments,
    guidance: event.guidance,
    promptContext: event.promptContext,
    signal: event.signal,
    promptBody: event.promptBody,
  })

  return event
}

/**
 * Build a prompt message from an agent session event
 */
export function buildPromptFromSession(event: AgentSessionEvent): string {
  const { issue, comment, promptContext } = event

  let message = `Issue: ${issue.identifier} - ${issue.title}\n\n`

  if (issue.description) {
    message += `Description:\n${issue.description}\n\n`
  }

  if (comment?.body) {
    // Extract the actual user message (remove @mention)
    const userMessage = comment.body.replace(/@\S+\s*/g, '').trim()
    if (userMessage) {
      message += `User request:\n${userMessage}\n\n`
    }
  }

  // Include prompt context if available (contains thread history)
  if (promptContext) {
    message += `Context:\n${promptContext}\n`
  }

  return message
}
