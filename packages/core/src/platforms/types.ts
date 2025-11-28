/**
 * Types for Linear platform integration
 */

import type { LinearWebhook } from '@usepolvo/linear';

/**
 * Activity types the agent can report
 */
export type ActivityType = 'thinking' | 'tool_use' | 'responding' | 'error';

/**
 * Activity update to send to Linear
 */
export interface Activity {
  type: ActivityType;
  message: string;
  toolName?: string;
  toolInput?: unknown;
}

/**
 * Context for sending activity updates
 */
export interface ActivityContext {
  issueId: string;
  sessionId: string;
}

/**
 * Message in a conversation history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * Credentials for Linear API
 */
export interface LinearCredentials {
  accessToken: string;
  webhookSecret?: string;
}

/**
 * Helper to extract issue ID from a Linear webhook
 */
export function getIssueId(webhook: LinearWebhook): string {
  switch (webhook.type) {
    case 'AgentSessionEvent':
      return webhook.agentSession.issue.id;
    case 'AgentActivity':
      return webhook.agentSession.issue.id;
    case 'Issue':
      return webhook.data.id;
    case 'Comment':
      return webhook.data.issueId;
  }
}

/**
 * Helper to extract agent session ID from a Linear webhook (if available)
 */
export function getAgentSessionId(webhook: LinearWebhook): string | undefined {
  switch (webhook.type) {
    case 'AgentSessionEvent':
      return webhook.agentSession.id;
    case 'AgentActivity':
      return webhook.agentSession.id;
    default:
      return undefined;
  }
}

/**
 * Helper to get the user message from a webhook
 */
export function getUserMessage(webhook: LinearWebhook): string | undefined {
  switch (webhook.type) {
    case 'AgentSessionEvent':
      return webhook.agentSession.comment.body;
    case 'AgentActivity':
      return webhook.agentActivity.content.body;
    case 'Issue':
      return webhook.data.description ?? undefined;
    default:
      return undefined;
  }
}

/**
 * Helper to get issue context for the LLM
 */
export function getIssueContext(webhook: LinearWebhook): {
  title: string;
  description?: string;
  url: string;
} {
  switch (webhook.type) {
    case 'AgentSessionEvent':
      return {
        title: webhook.agentSession.issue.title,
        description: webhook.agentSession.issue.description,
        url: webhook.agentSession.issue.url,
      };
    case 'AgentActivity':
      return {
        title: webhook.agentSession.issue.title,
        description: webhook.agentSession.issue.description,
        url: webhook.agentSession.issue.url,
      };
    case 'Issue':
      return {
        title: webhook.data.title,
        description: webhook.data.description ?? undefined,
        url: webhook.data.url ?? '',
      };
    case 'Comment':
      // Comment webhooks don't have full issue context
      return { title: '', url: '' };
  }
}
