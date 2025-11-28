/**
 * Agent Runner
 *
 * Executes an agent in response to a Linear webhook.
 */

import type { LinearWebhook } from '@usepolvo/linear';
import type { Platform } from '../platforms/platform.js';
import { getIssueId, getUserMessage, getIssueContext } from '../platforms/types.js';
import type { AnthropicClient } from '../llm/anthropic.js';

export interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model?: {
    name?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };
    tools?: unknown[];
    mcpServers?: Array<{
      type: string;
      url: string;
      name: string;
      authorization_token?: string;
      tool_configuration?: unknown;
    }>;
  };
}

export interface AgentRunOptions {
  webhook: LinearWebhook;
  config: AgentConfig;
  platform: Platform;
  llmClient: AnthropicClient;
  sessionId: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentRunResult {
  success: boolean;
  response?: string;
  tokensUsed?: number;
  error?: string;
}

/**
 * Run an agent in response to a Linear webhook
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const { webhook, config, platform, llmClient, sessionId, conversationHistory } = options;

  const issueId = getIssueId(webhook);
  const isConversation = !!conversationHistory && conversationHistory.length > 0;

  const activityCtx = { issueId, sessionId };

  try {
    // 1. Send initial thinking activity
    await platform.sendActivity(activityCtx, {
      type: 'thinking',
      message: isConversation
        ? `[Agent: ${config.name}] Thinking...`
        : `[Agent: ${config.name}] Analyzing issue...`,
    });

    // 2. Build context for LLM
    let messageContent: string;
    let conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;

    if (isConversation && conversationHistory) {
      conversationMessages = [...conversationHistory];

      // Add the new user message from the webhook
      const userMessage = getUserMessage(webhook);
      if (userMessage) {
        conversationMessages.push({ role: 'user', content: userMessage });
      }

      messageContent = '';
    } else {
      // Initial message: use issue context
      const issueContext = getIssueContext(webhook);
      messageContent = JSON.stringify(issueContext, null, 2);
    }

    // 3. Call LLM with callbacks for activities
    const response = await llmClient.sendMessage({
      systemPrompt: config.systemPrompt,
      userMessage: isConversation ? undefined : messageContent,
      conversationMessages: isConversation ? conversationMessages : undefined,
      maxTokens: config.model?.maxTokens,
      temperature: config.model?.temperature,
      thinking: config.model?.thinking,
      tools: config.model?.tools,
      mcpServers: config.model?.mcpServers,

      onToolUse: async (tool) => {
        await platform.sendActivity(activityCtx, {
          type: 'tool_use',
          message: `Using ${tool.name}`,
          toolName: tool.name,
          toolInput: tool.input,
        });
      },

      onThinking: async (thinking) => {
        await platform.sendActivity(activityCtx, {
          type: 'thinking',
          message: thinking.thinking,
        });
      },

      onInterimText: async (text) => {
        await platform.sendActivity(activityCtx, {
          type: 'thinking',
          message: text,
        });
      },
    });

    // 4. Send response
    const formattedResponse = `[Agent: ${config.name}]\n\n${response.content}`;

    await platform.sendActivity(activityCtx, {
      type: 'responding',
      message: formattedResponse,
    });

    return {
      success: true,
      response: response.content,
      tokensUsed: response.tokensUsed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Agent run failed';

    try {
      await platform.sendActivity(activityCtx, {
        type: 'error',
        message: `[Agent: ${config.name}] Error: ${errorMessage}`,
      });
    } catch {
      // Ignore errors when sending error activity
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}
