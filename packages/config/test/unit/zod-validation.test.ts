// Test Zod v4 validation behavior
// Run with: tsx test/unit/zod-validation.test.ts

import { validateConfig } from '../../src/index.js';
import type { Config } from '../../src/index.js';

console.log('🧪 Testing Zod v4 Validation\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Valid minimal config
const validConfig: Config = {
  version: '1.0',
  agent: {
    id: 'test-agent',
    name: 'Test Agent',
    system_prompt: 'You are a test agent',
    model: {
      anthropic: {
        name: 'claude-3-5-sonnet-20241022',
      },
    },
  },
};

// Test 1: Valid config passes
test('Valid config passes validation', () => {
  const result = validateConfig(validConfig);
  assert(result.version === '1.0', 'Should preserve version');
});

// Test 2: Invalid config throws with .issues (Zod v4)
test('Invalid config throws ZodError with issues array', () => {
  try {
    validateConfig({ invalid: 'config' } as any);
    throw new Error('Should have thrown');
  } catch (error: any) {
    assert(error.name === 'ZodError', 'Should be ZodError');
    assert(Array.isArray(error.issues), 'Should have issues array (v4)');
    assert(!error.errors, 'Should not have errors property (v3)');
  }
});

// Test 3: Default values work
test('Applies default values for temperature and max_tokens', () => {
  const config = validateConfig(validConfig);
  assert(config.agent.model.anthropic.temperature === 1.0, 'Default temp is 1.0');
  assert(config.agent.model.anthropic.max_tokens === 4096, 'Default max_tokens is 4096');
});

// Test 4: Refinement - thinking requires temperature = 1
test('Refinement: thinking requires temperature = 1', () => {
  try {
    validateConfig({
      ...validConfig,
      agent: {
        ...validConfig.agent,
        model: {
          anthropic: {
            name: 'claude-sonnet-4-5-20250929',
            temperature: 0.5,
            thinking: { type: 'enabled', budget_tokens: 1000 },
          },
        },
      },
    } as Config);
    throw new Error('Should have thrown');
  } catch (error: any) {
    assert(
      error.issues.some((i: any) => i.message.includes('temperature')),
      'Error mentions temperature',
    );
  }
});

// Test 5: Refinement - web_search requires capable model
test('Refinement: web_search requires sonnet-4-5', () => {
  try {
    validateConfig({
      ...validConfig,
      agent: {
        ...validConfig.agent,
        model: {
          anthropic: {
            name: 'claude-3-5-sonnet-20241022',
            tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          },
        },
      },
    } as Config);
    throw new Error('Should have thrown');
  } catch (error: any) {
    assert(error.issues[0].message.includes('web_search'), 'Error mentions web_search');
  }
});

// Test 6: Discriminated union for tools
test('Discriminated union correctly validates tool types', () => {
  const configWithTools = validateConfig({
    ...validConfig,
    agent: {
      ...validConfig.agent,
      model: {
        anthropic: {
          name: 'claude-sonnet-4-5-20250929',
          tools: [
            { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
            { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 10 },
          ],
        },
      },
    },
  } as Config);
  assert(configWithTools.agent.model.anthropic.tools?.length === 2, 'Has 2 tools');
});

// Test 7: Optional fields and defaults
test('Optional fields can be omitted, tools default to empty array', () => {
  const config = validateConfig(validConfig);
  assert(!config.agent.description, 'Description is optional');
  assert(Array.isArray(config.agent.model.anthropic.tools), 'Tools default to empty array');
  assert(config.agent.model.anthropic.tools.length === 0, 'Empty tools array');
});

// Test 8: String constraints (regex, length)
test('Agent ID validates against pattern', () => {
  try {
    validateConfig({
      ...validConfig,
      agent: { ...validConfig.agent, id: 'Invalid ID!' },
    } as Config);
    throw new Error('Should have thrown');
  } catch (error: any) {
    assert(error.issues[0].path.includes('id'), 'Error on ID field');
  }
});

// Test 9: Number constraints
test('Temperature must be between 0 and 1', () => {
  try {
    validateConfig({
      ...validConfig,
      agent: {
        ...validConfig.agent,
        model: { anthropic: { name: 'claude-3-5-sonnet-20241022', temperature: 1.5 } },
      },
    } as Config);
    throw new Error('Should have thrown');
  } catch (error: any) {
    assert(error.issues[0].path.includes('temperature'), 'Error on temperature');
  }
});

// Test 10: MCP server URL validation
test('MCP server URL must be valid', () => {
  try {
    validateConfig({
      ...validConfig,
      agent: {
        ...validConfig.agent,
        model: {
          anthropic: {
            name: 'claude-3-5-sonnet-20241022',
            mcp_servers: [{ type: 'url', url: 'not-a-url', name: 'Test' }],
          },
        },
      },
    } as Config);
    throw new Error('Should have thrown');
  } catch (error: any) {
    assert(error.issues[0].path.includes('url'), 'Error on URL field');
  }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
