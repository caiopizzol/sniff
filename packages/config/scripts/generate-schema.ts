#!/usr/bin/env tsx
/**
 * Generate config.schema.json from Zod schema
 * This ensures the JSON Schema stays in sync with the Zod validation
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as z from 'zod';
import { ConfigSchema } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Convert Zod schema to JSON Schema using native Zod v4 function
const jsonSchema = z.toJSONSchema(ConfigSchema);

// Add custom metadata fields
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://sniff.dev/schemas/config.schema.json',
  title: 'Sniff Agent Configuration',
  description: 'Schema for Sniff agent configuration file (config.yml) version 1.0',
  ...jsonSchema,
  examples: [
    // Example 1: Minimal triage agent
    {
      version: '1.0',
      agent: {
        id: 'triage-bot',
        name: 'Triage Assistant',
        system_prompt:
          'You are a triage specialist.\nClassify issues as BUG/FEATURE/QUESTION/TASK.\nSet priority P0-P3.',
        model: {
          anthropic: {
            name: 'claude-3-5-sonnet-20241022',
            temperature: 1.0,
            max_tokens: 4096,
          },
        },
      },
    },
    // Example 2: Docs search agent with web tools
    {
      version: '1.0',
      agent: {
        id: 'docs-search-agent',
        name: 'Documentation Oracle',
        description: 'Searches documentation to answer questions with precision and context',
        system_prompt:
          'You are a Documentation Oracle that helps users find answers in documentation.',
        model: {
          anthropic: {
            name: 'claude-sonnet-4-5-20250929',
            temperature: 0.5,
            max_tokens: 3000,
            tool_choice: {
              type: 'auto',
            },
            tools: [
              {
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: 10,
              },
              {
                type: 'web_fetch_20250910',
                name: 'web_fetch',
                max_uses: 20,
                citations: {
                  enabled: true,
                },
              },
            ],
          },
        },
      },
    },
    // Example 3: Linear integration with MCP
    {
      version: '1.0',
      agent: {
        id: 'linear-assistant',
        name: 'Linear Assistant',
        description: 'Helps manage and query Linear issues using MCP integration',
        system_prompt:
          'You are a helpful assistant that can search and retrieve Linear issues.\nUse the available tools to help users find information about their issues.',
        model: {
          anthropic: {
            name: 'claude-sonnet-4-5-20250929',
            temperature: 0.7,
            max_tokens: 4000,
            mcp_servers: [
              {
                type: 'url',
                url: 'https://api.sniff.to/mcp/linear',
                name: 'Linear Integration',
                tool_configuration: {
                  enabled: true,
                  allowed_tools: ['get_issue', 'search_issues'],
                },
              },
            ],
          },
        },
      },
    },
  ],
};

// Write to root config.schema.json
const outputPath = resolve(__dirname, '../../../config.schema.json');
writeFileSync(outputPath, JSON.stringify(schema, null, 2) + '\n');

console.log('✅ Generated config.schema.json from Zod schema');
console.log(`   Output: ${outputPath}`);
