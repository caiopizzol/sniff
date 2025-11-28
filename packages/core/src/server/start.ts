/**
 * Server Startup
 *
 * Entry point for running the Sniff server.
 * Loads config, initializes Linear and LLM, and starts the server.
 */

import { loadConfig } from '@sniff-dev/config';
import { createSniffServer, type SniffServerConfig } from './index.js';
import { LinearPlatform } from '../platforms/index.js';
import { createAnthropicClient } from '../llm/anthropic.js';
import { createTokenStorage } from '../storage/index.js';
import type { AgentConfig } from '../agent/runner.js';

export interface StartServerOptions {
  configPath?: string;
  port?: number;
}

/**
 * Get Linear access token from env var or storage
 */
async function getLinearToken(): Promise<string> {
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

  throw new Error(
    'No Linear access token found. Set LINEAR_ACCESS_TOKEN env var or run `sniff auth linear`.',
  );
}

/**
 * Start the Sniff server
 */
export async function startServer(options: StartServerOptions = {}): Promise<void> {
  const configPath = options.configPath ?? 'sniff.yml';

  // Load configuration
  console.log('Loading configuration...');
  const config = loadConfig(configPath);
  console.log('Configuration loaded');

  // Read credentials
  const linearToken = await getLinearToken();
  const linearWebhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    throw new Error('Missing required environment variable: ANTHROPIC_API_KEY');
  }

  // Initialize Linear platform
  console.log('Initializing Linear platform...');
  const platform = new LinearPlatform();
  platform.initialize({
    accessToken: linearToken,
    webhookSecret: linearWebhookSecret || undefined,
  });
  console.log('Linear platform initialized');

  // Initialize LLM client
  console.log('Initializing LLM client...');
  const llmClient = createAnthropicClient({
    apiKey: anthropicKey,
  });
  console.log('LLM client initialized');

  // Convert config agents to AgentConfig format
  const agents: AgentConfig[] = config.agents.map((agent) => ({
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
  }));

  // Determine port
  const port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

  // Create and start server
  const serverConfig: SniffServerConfig = {
    port,
    platform,
    agents,
    llmClient,
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
  console.log('\nAgents:');
  for (const agent of agents) {
    console.log(`  - ${agent.name} (${agent.id})`);
  }
  console.log(`\nWebhook: POST http://localhost:${port}/webhook/linear`);
  console.log('\nPress Ctrl+C to stop');
}
