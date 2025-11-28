/**
 * Linear platform implementation
 */

import type { LinearWebhook } from '@usepolvo/linear';
import type { Platform } from '../platform.js';
import type {
  Activity,
  ActivityContext,
  ConversationMessage,
  LinearCredentials,
} from '../types.js';
import { LinearClient, QUERIES } from './client.js';
import { verifyLinearWebhook, parseLinearWebhook } from './webhook.js';

interface AgentSessionActivitiesResponse {
  agentSession: {
    activities: {
      edges: Array<{
        node: {
          updatedAt: string;
          content: {
            __typename?: string;
            body?: string;
          };
        };
      }>;
    };
  };
}

/**
 * Linear platform implementation
 */
export class LinearPlatform implements Platform {
  readonly name = 'linear' as const;
  private client: LinearClient | null = null;
  private webhookSecret: string | null = null;

  initialize(credentials: LinearCredentials): void {
    this.client = new LinearClient({ accessToken: credentials.accessToken });
    this.webhookSecret = credentials.webhookSecret || null;
  }

  private ensureClient(): LinearClient {
    if (!this.client) {
      throw new Error('LinearPlatform not initialized. Call initialize() first.');
    }
    return this.client;
  }

  // ─────────────────────────────────────────────────────────────
  // Webhook handling
  // ─────────────────────────────────────────────────────────────

  verifyWebhook(payload: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      return true; // Skip verification in dev mode
    }
    return verifyLinearWebhook(payload, signature, this.webhookSecret);
  }

  parseWebhook(payload: unknown): LinearWebhook | null {
    const result = parseLinearWebhook(payload);
    if (!result.success || !result.data) {
      return null;
    }
    return result.data;
  }

  shouldProcess(webhook: LinearWebhook): boolean {
    // Only process agent session events and prompt activities
    switch (webhook.type) {
      case 'AgentSessionEvent':
        return true;
      case 'AgentActivity':
        return webhook.agentActivity.content.type === 'prompt';
      default:
        return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────

  async sendActivity(ctx: ActivityContext, activity: Activity): Promise<void> {
    const client = this.ensureClient();

    let content: Record<string, unknown>;

    switch (activity.type) {
      case 'thinking':
        content = { type: 'thought', body: activity.message };
        break;
      case 'tool_use':
        content = {
          type: 'action',
          action: activity.toolName || 'tool',
          parameter: JSON.stringify(activity.toolInput || {}),
        };
        break;
      case 'responding':
        content = { type: 'response', body: activity.message };
        break;
      case 'error':
        content = { type: 'error', body: activity.message };
        break;
      default:
        content = { type: 'thought', body: activity.message };
    }

    await client.query(QUERIES.CREATE_AGENT_ACTIVITY, {
      sessionId: ctx.sessionId,
      content,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Context
  // ─────────────────────────────────────────────────────────────

  async getAgentSessionHistory(sessionId: string): Promise<ConversationMessage[]> {
    const client = this.ensureClient();

    const data = await client.query<AgentSessionActivitiesResponse>(
      QUERIES.GET_AGENT_SESSION_ACTIVITIES,
      { id: sessionId },
    );

    const messages: ConversationMessage[] = [];

    for (const edge of data.agentSession.activities.edges) {
      const node = edge.node;
      const content = node.content;

      if (content.body) {
        const isPrompt = content.__typename === 'AgentActivityPromptContent';
        const isResponse = content.__typename === 'AgentActivityResponseContent';

        if (isPrompt || isResponse) {
          messages.push({
            role: isPrompt ? 'user' : 'assistant',
            content: content.body,
            timestamp: new Date(node.updatedAt),
          });
        }
      }
    }

    messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return messages;
  }
}
