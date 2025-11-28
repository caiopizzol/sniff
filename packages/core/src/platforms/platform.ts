/**
 * Linear Platform
 *
 * Handles Linear webhook verification, API calls, and agent activities.
 */

import type { LinearWebhook } from '@usepolvo/linear';
import type { Activity, ActivityContext, ConversationMessage, LinearCredentials } from './types.js';

/**
 * Platform interface for Linear
 */
export interface Platform {
  readonly name: 'linear';

  initialize(credentials: LinearCredentials): void;

  // Webhook
  verifyWebhook(payload: string | Buffer, signature: string): boolean;
  parseWebhook(payload: unknown): LinearWebhook | null;
  shouldProcess(webhook: LinearWebhook): boolean;

  // Actions
  sendActivity(ctx: ActivityContext, activity: Activity): Promise<void>;

  // Context
  getAgentSessionHistory(sessionId: string): Promise<ConversationMessage[]>;
}
