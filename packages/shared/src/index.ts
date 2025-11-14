// packages/shared/src/index.ts
import type { Model, WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages.js';

// Re-export Model type from Anthropic SDK for convenience
export type ModelName = Model;

// Export MCP types
export * from './types/mcp.js';

// Server-side tool types for our config
// These are tools executed by Anthropic's infrastructure

// Use SDK's type directly for web_search
export type WebSearchTool = WebSearchTool20250305;

// web_fetch is still in beta and not yet in SDK types (as of @anthropic-ai/sdk@0.68.0)
// Define our own type matching the API structure
export type WebFetchTool = {
  type: 'web_fetch_20250910';
  name: 'web_fetch';
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  citations?: {
    enabled: boolean;
  };
  max_content_tokens?: number;
};

// Union of all supported tool types
export type Tool = WebSearchTool | WebFetchTool;

// Agent Configuration Types
export interface AgentConfig {
  version: '1.0';
  agent: {
    id: string;
    name: string;
    description?: string;
    system_prompt: string;
    model: ModelConfig;
  };
}

export type ThinkingConfig = { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };

export type ToolChoice =
  | { type: 'auto'; disable_parallel_tool_use?: boolean }
  | { type: 'any'; disable_parallel_tool_use?: boolean }
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
  | { type: 'none' };

/**
 * Anthropic-specific model configuration
 */
export interface AnthropicModelConfig {
  name: ModelName;
  temperature: number;
  max_tokens: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  thinking?: ThinkingConfig;
  metadata?: {
    user_id?: string;
  };
  tool_choice?: ToolChoice;
  tools?: Tool[];
  mcp_servers?: import('./types/mcp.js').MCPServerConfig[];
}

/**
 * Model configuration
 * Currently only Anthropic is supported. Future: add OpenAI support with discriminated union
 */
export type ModelConfig = {
  anthropic: AnthropicModelConfig;
};

// Multi-tenant Types
export interface Agent {
  id: string;
  userId: string;
  connectionId?: string; // Optional - agents can exist without active connection
  platform: string; // Where agent is deployed: 'linear', 'github', 'slack', etc.
  workspaceId: string; // Platform-specific workspace ID
  name: string;
  config: AgentConfig;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type AgentStatus = 'active' | 'paused' | 'error';

export interface Connection {
  id: string;
  userId: string;
  provider: Provider;
  ampersandInstallationId: string;
  workspaceId: string;
  createdAt: Date;
}

export type Provider = 'linear' | 'github' | 'slack' | 'notion';

// Linear Types
export interface LinearWebhook {
  action: LinearAction;
  type: LinearEventType;
  data: LinearIssue | LinearComment;
  url: string;
  createdAt: string;
}

export type LinearAction = 'create' | 'update' | 'remove';
export type LinearEventType = 'Issue' | 'Comment' | 'Project' | 'Cycle';

export interface LinearIssue {
  id: string;
  title: string;
  description?: string;
  priority: number;
  state: {
    id: string;
    name: string;
    type: string;
  };
  team: {
    id: string;
    key: string;
    name: string;
  };
  creator: {
    id: string;
    name: string;
    email: string;
  };
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface LinearComment {
  id: string;
  body: string;
  issue: {
    id: string;
    title: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

// User Types
export interface User {
  id: string;
  clerkId: string;
  email: string;
  createdAt: Date;
}

// Agent Run Types
export interface AgentRun {
  id: string;
  agentId: string;
  linearIssueId?: string;
  sessionId?: string;
  input: any;
  output?: any;
  error?: string;
  tokensUsed?: number;
  createdAt: Date;
  completedAt?: Date;
}

// API Types
export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: ApiError;
}

// Package info
/** Current package version */
export const VERSION = '0.1.0';
/** API version used for compatibility */
export const API_VERSION = 'v1';
