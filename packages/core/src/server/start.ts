/**
 * Server Startup
 *
 * Entry point for running the Sniff server.
 * Loads config, initializes Linear and LLM, and starts the server.
 */

import { parseAndValidateConfig } from '@sniff-dev/config';
import { createSniffServer, type SniffServerConfig } from './index.js';
import { LinearPlatform } from '../platforms/index.js';
import { createAnthropicClient } from '../llm/anthropic.js';
import { createTokenStorage, createConfigStorage } from '../storage/index.js';
import type { AgentConfig } from '../agent/runner.js';

export interface StartServerOptions {
  port?: number;
}

/**
 * Get Linear access token from env var or storage
 */
async function getLinearToken(): Promise<string | null> {
  // First check environment variable
  const envToken = process.env.LINEAR_ACCESS_TOKEN;
  if (envToken) {
    return envToken;
  }

  // Fall back to stored OAuth2 token
  const storage = createTokenStorage();
  try {
    const tokens = await storage.get();
    if (tokens?.accessToken) {
      return tokens.accessToken;
    }
  } finally {
    storage.close();
  }

  return null;
}

/**
 * Start the Sniff server
 */
export async function startServer(options: StartServerOptions = {}): Promise<void> {
  // Load configuration from DB (if exists)
  console.log('Loading configuration from database...');
  const configStorage = createConfigStorage();
  let yamlContent: string | null;
  try {
    yamlContent = await configStorage.get();
  } finally {
    configStorage.close();
  }

  const config = yamlContent ? parseAndValidateConfig(yamlContent) : null;
  if (config) {
    console.log('Configuration loaded');
  } else {
    console.log('No config found. Deploy agents with: sniff deploy --server <url>');
  }

  // Read credentials
  const linearToken = await getLinearToken();
  const linearWebhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Only require credentials when there's a config with agents
  const hasAgents = config && config.agents.length > 0;

  if (hasAgents && !linearToken) {
    throw new Error(
      'No Linear access token found. Set LINEAR_ACCESS_TOKEN env var or run `sniff auth linear`.',
    );
  }

  if (hasAgents && !anthropicKey) {
    throw new Error('Missing required environment variable: ANTHROPIC_API_KEY');
  }

  // Initialize Linear platform (if token available)
  const platform = new LinearPlatform();
  if (linearToken) {
    console.log('Initializing Linear platform...');
    platform.initialize({
      accessToken: linearToken,
      webhookSecret: linearWebhookSecret || undefined,
    });
    console.log('Linear platform initialized');
  } else {
    console.log('Linear platform not initialized (no token). Set LINEAR_ACCESS_TOKEN to enable.');
  }

  // Initialize LLM client (if key available)
  const llmClient = anthropicKey ? createAnthropicClient({ apiKey: anthropicKey }) : null;
  if (llmClient) {
    console.log('LLM client initialized');
  } else {
    console.log('LLM client not initialized (no API key). Set ANTHROPIC_API_KEY to enable.');
  }

  // Convert config agents to AgentConfig format (empty if no config yet)
  const agents: AgentConfig[] = config
    ? config.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.system_prompt,
        model: {
          name: agent.model.anthropic.name,
          temperature: agent.model.anthropic.temperature,
          maxTokens: agent.model.anthropic.max_tokens,
          thinking: agent.model.anthropic.thinking,
          tools: agent.model.anthropic.tools,
          mcpServers: agent.model.anthropic.mcp_servers,
        },
      }))
    : [];

  // Determine port
  const port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

  // Get API key for remote deploy (optional)
  const apiKey = process.env.SNIFF_API_KEY;

  // OAuth config (optional, for cloud auth flow)
  const linearClientId = process.env.LINEAR_CLIENT_ID;
  const linearClientSecret = process.env.LINEAR_CLIENT_SECRET;
  const serverUrl = process.env.SNIFF_SERVER_URL || `http://localhost:${port}`;
  const oauth =
    linearClientId && linearClientSecret
      ? {
          clientId: linearClientId,
          clientSecret: linearClientSecret,
          redirectUri: `${serverUrl.replace(/\/$/, '')}/auth/linear/callback`,
        }
      : undefined;

  // Create and start server
  const serverConfig: SniffServerConfig = {
    port,
    platform,
    agents,
    llmClient,
    apiKey,
    oauth,
  };

  const server = createSniffServer(serverConfig);

  // Handle shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\nStarting Sniff server...\n');
  await server.start();

  console.log('\nServer is running!');
  if (agents.length > 0) {
    console.log('\nAgents:');
    for (const agent of agents) {
      console.log(`  - ${agent.name} (${agent.id})`);
    }
  } else {
    console.log(
      '\nNo agents configured. Deploy with: sniff deploy --server http://localhost:' + port,
    );
  }
  console.log(`\nWebhook: POST http://localhost:${port}/webhook/linear`);
  if (oauth) {
    console.log(`OAuth: ${serverUrl}/auth/linear`);
  }
  console.log('\nPress Ctrl+C to stop');
}
