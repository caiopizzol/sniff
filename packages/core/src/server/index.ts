/**
 * Sniff Server
 *
 * A simple headless server that:
 * - Receives webhooks from Linear
 * - Routes them to the appropriate agent
 * - Executes agents using the LLM
 * - Sends responses back via Linear
 * - Provides API for remote deployment
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Platform } from '../platforms/platform.js';
import { getAgentSessionId } from '../platforms/types.js';
import type { AnthropicClient } from '../llm/anthropic.js';
import { runAgent, type AgentConfig } from '../agent/runner.js';
import type { LinearWebhook } from '@usepolvo/linear';
import { parseAndValidateConfig } from '@sniff-dev/config';
import { createConfigStorage } from '../storage/index.js';
import { createLinearOAuth } from '../auth/oauth.js';
import { handleAuthStart, handleAuthCallback } from './auth.js';

export interface SniffServerConfig {
  port: number;
  platform: Platform;
  agents: AgentConfig[];
  llmClient: AnthropicClient | null;
  apiKey?: string;
  oauth?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
}

export interface SniffServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  updateAgents(agents: AgentConfig[]): void;
  getAgents(): AgentConfig[];
}

/**
 * Create a Sniff server instance
 */
export function createSniffServer(config: SniffServerConfig): SniffServer {
  const { port, platform, llmClient, apiKey, oauth: oauthConfig } = config;

  // Mutable agents array for hot-reload
  let currentAgents = [...config.agents];

  // Create OAuth client if credentials provided
  const oauth = oauthConfig
    ? createLinearOAuth({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        redirectUri: oauthConfig.redirectUri,
      })
    : null;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // OAuth: Start authorization
    if (req.method === 'GET' && req.url === '/auth/linear') {
      if (!oauth) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'OAuth not configured. Set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET.',
          }),
        );
        return;
      }
      handleAuthStart(req, res, { oauth });
      return;
    }

    // OAuth: Handle callback
    if (req.method === 'GET' && req.url?.startsWith('/auth/linear/callback')) {
      if (!oauth) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OAuth not configured' }));
        return;
      }
      await handleAuthCallback(req, res, { oauth });
      return;
    }

    // API: Get status
    if (req.method === 'GET' && req.url === '/api/status') {
      if (!checkApiAuth(req, res, apiKey)) return;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          agents: currentAgents.map((a) => ({ id: a.id, name: a.name })),
        }),
      );
      return;
    }

    // API: Deploy config
    if (req.method === 'POST' && req.url === '/api/deploy') {
      if (!checkApiAuth(req, res, apiKey)) return;

      try {
        const body = await readBody(req);
        const { config: yamlContent } = JSON.parse(body);

        if (!yamlContent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing config in request body' }));
          return;
        }

        // Parse and validate the YAML config
        const parsedConfig = parseAndValidateConfig(yamlContent);

        // Convert to AgentConfig format
        const newAgents: AgentConfig[] = parsedConfig.agents.map((agent) => ({
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

        currentAgents = newAgents;

        // Persist config to DB
        const configStorage = createConfigStorage();
        try {
          await configStorage.set(yamlContent);
        } finally {
          configStorage.close();
        }

        console.log(`Deployed ${currentAgents.length} agent(s)`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            agents: currentAgents.map((a) => ({ id: a.id, name: a.name })),
          }),
        );
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (error as Error).message }));
      }
      return;
    }

    // Webhook endpoint
    if (req.method === 'POST' && req.url === '/webhook/linear') {
      // Check if LLM client is configured
      if (!llmClient) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server not configured. Set ANTHROPIC_API_KEY.' }));
        return;
      }

      try {
        const body = await readBody(req);
        const signature = (req.headers['linear-signature'] as string) || '';

        // Verify webhook
        if (!platform.verifyWebhook(body, signature)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid webhook signature' }));
          return;
        }

        // Parse webhook
        const payload = JSON.parse(body);
        const webhook = platform.parseWebhook(payload);

        if (!webhook) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ignored' }));
          return;
        }

        // Check if we should process
        if (!platform.shouldProcess(webhook)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'skipped' }));
          return;
        }

        // Find agent
        const agent = findAgent(currentAgents, webhook);
        if (!agent) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'no_matching_agent' }));
          return;
        }

        // Respond immediately, process async
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'processing' }));

        // Get session ID from webhook
        const sessionId = getAgentSessionId(webhook);
        if (!sessionId) {
          console.error('No agent session ID in webhook');
          return;
        }

        // Run agent
        runAgent({
          webhook,
          config: agent,
          platform,
          llmClient,
          sessionId,
        }).catch((error) => {
          console.error('Agent run failed:', error);
        });
      } catch (error) {
        console.error('Webhook processing error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }

      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return {
    start: () =>
      new Promise((resolve) => {
        server.listen(port, () => {
          console.log(`Sniff server listening on port ${port}`);
          console.log(`Webhook endpoint: POST /webhook/linear`);
          console.log(`API endpoints: GET /api/status, POST /api/deploy`);
          resolve();
        });
      }),

    stop: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),

    updateAgents: (agents: AgentConfig[]) => {
      currentAgents = agents;
      console.log(`Updated agents: ${agents.length} agent(s)`);
    },

    getAgents: () => [...currentAgents],
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function checkApiAuth(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string | undefined,
): boolean {
  // If no API key configured, allow all requests
  if (!apiKey) return true;

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
    return false;
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid API key' }));
    return false;
  }

  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function findAgent(agents: AgentConfig[], webhook: LinearWebhook): AgentConfig | null {
  // TODO: Add filtering based on webhook data
  return agents[0] || null;
}

// Export startServer
export { startServer, type StartServerOptions } from './start.js';
