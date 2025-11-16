// packages/config/src/index.ts
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { z } from 'zod';

// Model capabilities (which features each model supports)
// Used for validating that requested features are available on the selected model
// Anthropic's API will reject invalid model names, so we don't validate model names here
export const MODEL_CAPABILITIES: Record<string, string[]> = {
  'claude-sonnet-4-5-20250929': ['web_search', 'web_fetch', 'thinking', 'mcp'],
  'claude-opus-4-1-20250805': ['web_search', 'web_fetch', 'thinking', 'mcp'],
  'claude-haiku-4-5-20251001': ['web_search', 'web_fetch', 'mcp'],
  'claude-3-7-sonnet-20250219': ['web_search', 'web_fetch', 'thinking', 'mcp'],
  'claude-sonnet-4-20250514': ['web_search', 'web_fetch', 'thinking', 'mcp'],
  'claude-3-5-sonnet-20241022': ['thinking', 'mcp'], // Older model, no server tools
  'claude-3-5-haiku-20241022': ['mcp'], // Older model, no server tools or thinking
};

// Tool Schemas
// Web Search Tool - Discovery and exploration
const WebSearchToolSchema = z.object({
  type: z.literal('web_search_20250305'),
  name: z.literal('web_search'),
  max_uses: z.number().int().min(1).optional(),
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
  user_location: z
    .object({
      type: z.literal('approximate'),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});

// Web Fetch Tool - Content extraction from specific URLs
const WebFetchToolSchema = z.object({
  type: z.literal('web_fetch_20250910'),
  name: z.literal('web_fetch'),
  max_uses: z.number().int().min(1).optional(),
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
  citations: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  max_content_tokens: z.number().int().min(1).optional(),
});

// Union of all supported tool types
const ToolSchema = z.discriminatedUnion('type', [WebSearchToolSchema, WebFetchToolSchema]);

// MCP Server Schema - Integration tools via Model Context Protocol
const MCPServerSchema = z.object({
  type: z.literal('url'),
  url: z.string().url(),
  name: z.string().min(1).max(100),
  authorization_token: z.string().optional(),
  tool_configuration: z
    .object({
      enabled: z.boolean().optional(),
      allowed_tools: z.array(z.string()).optional(),
      disabled_tools: z.array(z.string()).optional(),
    })
    .optional(),
});

// Anthropic Model Configuration Schema
const AnthropicModelSchema = z.object({
  name: z.string().min(1),
  temperature: z.number().min(0).max(1).default(1.0), // Match Anthropic's default
  max_tokens: z.number().int().min(1).max(8192).default(4096), // Match Anthropic's default
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().min(0).optional(),
  stop_sequences: z.array(z.string()).max(10).optional(),
  thinking: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('enabled'),
        budget_tokens: z.number().int().min(1024),
      }),
      z.object({
        type: z.literal('disabled'),
      }),
    ])
    .optional(),
  metadata: z
    .object({
      user_id: z.string().max(256).optional(),
    })
    .optional(),
  tool_choice: z
    .union([
      z.object({
        type: z.literal('auto'),
        disable_parallel_tool_use: z.boolean().optional(),
      }),
      z.object({ type: z.literal('any'), disable_parallel_tool_use: z.boolean().optional() }),
      z.object({
        type: z.literal('tool'),
        name: z.string(),
        disable_parallel_tool_use: z.boolean().optional(),
      }),
      z.object({ type: z.literal('none') }),
    ])
    .optional(),
  tools: z.array(ToolSchema).default([]),
  mcp_servers: z.array(MCPServerSchema).optional(),
});

// Model Configuration Schema
// Currently only Anthropic is supported. Future: add OpenAI with discriminated union
const ModelConfigSchema = z.object({
  anthropic: AnthropicModelSchema,
});

// v1.0 Configuration Schema
export const ConfigSchema = z
  .object({
    version: z.literal('1.0'),

    agent: z.object({
      id: z
        .string()
        .min(1)
        .max(50)
        .regex(/^[a-z0-9-]+$/, 'Agent ID must be lowercase alphanumeric with hyphens'),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      system_prompt: z.string().min(1).max(10000),
      model: ModelConfigSchema,
    }),
  })
  .refine(
    (config) => {
      // When thinking is enabled on Anthropic, temperature must be 1
      if (
        'anthropic' in config.agent.model &&
        config.agent.model.anthropic.thinking?.type === 'enabled'
      ) {
        return config.agent.model.anthropic.temperature === 1;
      }
      return true;
    },
    {
      message:
        'When extended thinking is enabled, temperature must be set to 1. See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking',
      path: ['agent', 'model', 'anthropic', 'temperature'],
    },
  )
  .refine(
    (config) => {
      // When thinking is enabled on Anthropic, max_tokens must be greater than budget_tokens
      if (
        'anthropic' in config.agent.model &&
        config.agent.model.anthropic.thinking?.type === 'enabled'
      ) {
        return (
          config.agent.model.anthropic.max_tokens >
          config.agent.model.anthropic.thinking.budget_tokens
        );
      }
      return true;
    },
    {
      message:
        'max_tokens must be greater than thinking.budget_tokens. See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size',
      path: ['agent', 'model', 'anthropic', 'max_tokens'],
    },
  )
  .refine(
    (config) => {
      // Validate model capabilities - web_search
      if ('anthropic' in config.agent.model) {
        const modelName = config.agent.model.anthropic.name;
        const capabilities = MODEL_CAPABILITIES[modelName] || [];
        const hasWebSearch = config.agent.model.anthropic.tools?.some(
          (t) => t.type === 'web_search_20250305',
        );

        if (hasWebSearch && !capabilities.includes('web_search')) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'This model does not support web_search_20250305 tool. Supported models: claude-sonnet-4-5-20250929, claude-opus-4-1-20250805, claude-haiku-4-5-20251001, claude-3-7-sonnet-20250219, claude-sonnet-4-20250514',
      path: ['agent', 'model', 'anthropic', 'tools'],
    },
  )
  .refine(
    (config) => {
      // Validate model capabilities - web_fetch
      if ('anthropic' in config.agent.model) {
        const modelName = config.agent.model.anthropic.name;
        const capabilities = MODEL_CAPABILITIES[modelName] || [];
        const hasWebFetch = config.agent.model.anthropic.tools?.some(
          (t) => t.type === 'web_fetch_20250910',
        );

        if (hasWebFetch && !capabilities.includes('web_fetch')) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'This model does not support web_fetch_20250910 tool. Supported models: claude-sonnet-4-5-20250929, claude-opus-4-1-20250805, claude-haiku-4-5-20251001, claude-3-7-sonnet-20250219, claude-sonnet-4-20250514',
      path: ['agent', 'model', 'anthropic', 'tools'],
    },
  )
  .refine(
    (config) => {
      // Validate model capabilities - thinking
      if ('anthropic' in config.agent.model) {
        const modelName = config.agent.model.anthropic.name;
        const capabilities = MODEL_CAPABILITIES[modelName] || [];
        const hasThinking = config.agent.model.anthropic.thinking?.type === 'enabled';

        if (hasThinking && !capabilities.includes('thinking')) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'This model does not support extended thinking. Supported models: claude-sonnet-4-5-20250929, claude-opus-4-1-20250805, claude-3-7-sonnet-20250219, claude-sonnet-4-20250514, claude-3-5-sonnet-20241022',
      path: ['agent', 'model', 'anthropic', 'thinking'],
    },
  );

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Interpolate environment variables in YAML content
 * Supports syntax: ${VAR_NAME} and ${VAR_NAME:-default_value}
 *
 * @param yamlContent - Raw YAML string with potential env var references
 * @returns YAML string with env vars interpolated
 * @throws Error if a required env var (no default) is not set
 *
 * @example
 * // With env var set: RAGIE_API_KEY=secret123
 * interpolateEnvVars('token: ${RAGIE_API_KEY}')
 * // Returns: 'token: secret123'
 *
 * @example
 * // With default value when env var not set
 * interpolateEnvVars('url: ${API_URL:-https://default.com}')
 * // Returns: 'url: https://default.com'
 */
export function interpolateEnvVars(yamlContent: string): string {
  // Regex matches: ${VAR_NAME} or ${VAR_NAME:-default_value}
  // Capturing groups:
  //   1: VAR_NAME
  //   2: Full default part (:-default) - optional
  //   3: default_value (without :-) - optional
  const regex = /\$\{([A-Z_][A-Z0-9_]*)(:-([^}]*))?\}/g;

  return yamlContent.replace(regex, (_match, varName, hasDefault, defaultValue) => {
    const envValue = process.env[varName];

    // If env var is set, use it (even if empty string)
    if (envValue !== undefined) {
      return envValue;
    }

    // If env var not set but has default, use default
    if (hasDefault !== undefined) {
      return defaultValue || '';
    }

    // Required env var missing - throw error
    throw new Error(
      `Environment variable ${varName} is not set and has no default value. ` +
        `Use \${${varName}:-default} to provide a default, or set ${varName} in your environment.`,
    );
  });
}

/**
 * Load and validate config from a file path
 */
export function loadConfig(path = 'config.yml'): Config {
  try {
    const file = readFileSync(path, 'utf-8');
    const interpolated = interpolateEnvVars(file);
    const parsed = parse(interpolated);
    return ConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid configuration in', path);
      console.error('\nValidation errors:');
      error.errors.forEach((err) => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\nCheck your config.yml against CONFIG_SPEC_V1.md');
      throw new Error('Invalid configuration');
    }
    throw error;
  }
}

/**
 * Validate a parsed config object
 */
export function validateConfig(config: unknown): z.infer<typeof ConfigSchema> {
  return ConfigSchema.parse(config);
}

/**
 * Parse YAML string and validate (with environment variable interpolation)
 */
export function parseAndValidateConfig(yamlContent: string): z.infer<typeof ConfigSchema> {
  const interpolated = interpolateEnvVars(yamlContent);
  const parsed = parse(interpolated);
  return validateConfig(parsed);
}
