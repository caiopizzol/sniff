#!/usr/bin/env tsx
/**
 * Generate Schema Reference documentation from config.schema.json
 * Parses JSON Schema and generates markdown documentation dynamically
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import MODEL_CAPABILITIES from source (single source of truth)
import { MODEL_CAPABILITIES } from '../src/index.ts';

interface JSONSchema {
  type?: string | string[];
  const?: unknown;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  default?: unknown;
  additionalProperties?: boolean;
  $ref?: string;
  definitions?: Record<string, JSONSchema>;
}

interface SchemaProperty {
  name: string;
  type: string;
  required: boolean;
  constraints: string[];
  default?: unknown;
}

class SchemaParser {
  private schema: JSONSchema;
  private lines: string[] = [];

  constructor(schemaPath: string) {
    this.schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  }

  /**
   * Format a JSON Schema type into readable string
   */
  formatType(schema: JSONSchema): string {
    if (schema.const !== undefined) {
      return `\`"${schema.const}"\``;
    }

    if (schema.anyOf || schema.oneOf) {
      return '`object`'; // Union types are documented separately
    }

    if (schema.type === 'array') {
      if (schema.items?.anyOf) {
        return '`array`';
      }
      const itemType = schema.items ? this.formatType(schema.items) : '`any`';
      return itemType.replace(/`/g, '') + '[]';
    }

    if (schema.type === 'object') {
      return '`object`';
    }

    if (Array.isArray(schema.type)) {
      return schema.type.map((t) => `\`${t}\``).join(' | ');
    }

    return `\`${schema.type || 'any'}\``;
  }

  /**
   * Extract constraints from schema
   */
  extractConstraints(schema: JSONSchema): string[] {
    const constraints: string[] = [];

    if (schema.pattern) {
      constraints.push(`Pattern: \`${schema.pattern}\``);
    }

    if (schema.minLength !== undefined || schema.maxLength !== undefined) {
      if (schema.minLength !== undefined && schema.maxLength !== undefined) {
        constraints.push(`Length: ${schema.minLength}-${schema.maxLength}`);
      } else if (schema.minLength !== undefined) {
        constraints.push(`Min length: ${schema.minLength}`);
      } else if (schema.maxLength !== undefined) {
        constraints.push(`Max length: ${schema.maxLength}`);
      }
    }

    if (schema.minimum !== undefined || schema.maximum !== undefined) {
      if (schema.minimum !== undefined && schema.maximum !== undefined) {
        constraints.push(`${schema.minimum} - ${schema.maximum}`);
      } else if (schema.minimum !== undefined) {
        constraints.push(`≥ ${schema.minimum}`);
      } else if (schema.maximum !== undefined) {
        constraints.push(`≤ ${schema.maximum}`);
      }
    }

    if (schema.minItems !== undefined || schema.maxItems !== undefined) {
      if (schema.maxItems !== undefined) {
        constraints.push(`Max ${schema.maxItems} items`);
      }
      if (schema.minItems !== undefined) {
        constraints.push(`Min ${schema.minItems} items`);
      }
    }

    if (schema.format) {
      constraints.push(`Format: ${schema.format}`);
    }

    return constraints;
  }

  /**
   * Parse properties from schema object
   */
  parseProperties(
    properties: Record<string, JSONSchema>,
    required: string[] = [],
  ): SchemaProperty[] {
    return Object.entries(properties).map(([name, schema]) => ({
      name,
      type: this.formatType(schema),
      required: required.includes(name),
      constraints: this.extractConstraints(schema),
      default: schema.default,
    }));
  }

  /**
   * Generate markdown table from properties
   */
  generateTable(
    props: SchemaProperty[],
    includeConstraints: boolean = true,
    includeDefault: boolean = true,
  ): string {
    const headers: string[] = ['Field', 'Type', 'Required'];
    if (includeConstraints) headers.push('Constraints');
    if (includeDefault) headers.push('Default');

    const separator = headers.map(() => '--------').join(' | ');
    const headerRow = headers.join(' | ');

    const rows = props.map((prop) => {
      const cells: string[] = [`\`${prop.name}\``, prop.type, prop.required ? '✓' : ''];

      if (includeConstraints) {
        cells.push(prop.constraints.length > 0 ? prop.constraints.join('<br />') : '-');
      }

      if (includeDefault) {
        cells.push(prop.default !== undefined ? `\`${JSON.stringify(prop.default)}\`` : '-');
      }

      return cells.join(' | ');
    });

    return [headerRow, separator, ...rows].join('\n');
  }

  /**
   * Document a union type (anyOf/oneOf)
   */
  documentUnion(name: string, schema: JSONSchema, path: string): void {
    const unions = schema.anyOf || schema.oneOf || [];

    // Check if it's a discriminated union
    const discriminatorField = unions.every(
      (u: JSONSchema) => u.properties?.type?.const !== undefined,
    )
      ? 'type'
      : null;

    if (discriminatorField) {
      this.lines.push(`\n### ${path}`);
      this.lines.push('');
      this.lines.push(`Union type with ${unions.length} variants:\n`);

      unions.forEach((variant: JSONSchema) => {
        const variantType = variant.properties?.type?.const;
        this.lines.push(`**\`${variantType}\` variant:**\n`);

        const props = this.parseProperties(variant.properties || {}, variant.required || []);

        this.lines.push(this.generateTable(props, true, false));
        this.lines.push('');
      });
    } else {
      // Non-discriminated union - just list the variants
      this.lines.push(`\n### ${path}`);
      this.lines.push('');
      this.lines.push('Union type with the following variants:\n');
      unions.forEach((variant: JSONSchema, idx: number) => {
        this.lines.push(`${idx + 1}. ${this.formatType(variant)}`);
      });
      this.lines.push('');
    }
  }

  /**
   * Document array items
   */
  documentArray(name: string, schema: JSONSchema, path: string): void {
    if (!schema.items) return;

    const items = schema.items;

    if (items.anyOf || items.oneOf) {
      const unions = items.anyOf || items.oneOf || [];
      this.lines.push(`\n### ${path}[]`);
      this.lines.push('');
      this.lines.push('Array items must be one of:\n');

      unions.forEach((variant: JSONSchema) => {
        const variantType = variant.properties?.type?.const;
        if (variantType) {
          this.lines.push(`#### ${variantType}\n`);
        }

        const props = this.parseProperties(variant.properties || {}, variant.required || []);

        this.lines.push(this.generateTable(props, true, false));
        this.lines.push('');

        // Document nested structures within array items
        if (variant.properties) {
          Object.entries(variant.properties).forEach(([propName, propSchema]) => {
            if (propSchema.type === 'object' && propSchema.properties) {
              this.documentObject(`${path}[].${propName}`, propSchema);
            }
          });
        }
      });
    } else if (items.type === 'object' && items.properties) {
      this.documentObject(`${path}[]`, items);
    }
  }

  /**
   * Document an object schema
   */
  documentObject(path: string, schema: JSONSchema): void {
    if (!schema.properties) return;

    this.lines.push(`\n### ${path}`);
    this.lines.push('');

    const props = this.parseProperties(schema.properties, schema.required || []);

    const hasDefaults = props.some((p) => p.default !== undefined);
    const hasConstraints = props.some((p) => p.constraints.length > 0);

    this.lines.push(this.generateTable(props, hasConstraints, hasDefaults));
    this.lines.push('');

    // Recursively document nested objects, unions, and arrays
    Object.entries(schema.properties).forEach(([name, propSchema]) => {
      const fullPath = `${path}.${name}`;

      if (propSchema.anyOf || propSchema.oneOf) {
        this.documentUnion(name, propSchema, fullPath);
      } else if (propSchema.type === 'array') {
        this.documentArray(name, propSchema, fullPath);
      } else if (propSchema.type === 'object' && propSchema.properties) {
        this.documentObject(fullPath, propSchema);
      }
    });
  }

  /**
   * Generate model capabilities table
   */
  generateModelCapabilitiesTable(): string {
    const capabilities = MODEL_CAPABILITIES as Record<string, string[]>;
    const allFeatures = ['web_search', 'web_fetch', 'thinking', 'mcp'];

    const header = `| Model Name | ${allFeatures.join(' | ')} |`;
    const separator = `| ${Array(allFeatures.length + 1)
      .fill('---')
      .join(' | ')} |`;

    const rows = Object.entries(capabilities).map(([model, features]) => {
      const cells = allFeatures.map((feature) => (features.includes(feature) ? '✓' : ''));
      return `| \`${model}\` | ${cells.join(' | ')} |`;
    });

    return [header, separator, ...rows].join('\n');
  }

  /**
   * Generate complete schema reference page
   */
  generate(): string {
    const timestamp = new Date().toISOString().split('T')[0];

    // Add frontmatter
    this.lines.push('---');
    this.lines.push('title: Schema Reference');
    this.lines.push('description: Complete technical specification of all configuration fields');
    this.lines.push('---');
    this.lines.push('<Note>');
    this.lines.push('  **Auto-generated from JSON Schema**');
    this.lines.push('');
    this.lines.push(`  Last updated: ${timestamp}`);
    this.lines.push('');
    this.lines.push(
      '  This page provides the complete technical specification of all configuration fields. For explanations and best practices, see the [Configuration](/configuration) guide.',
    );
    this.lines.push('</Note>');
    this.lines.push('');

    // Get the root schema properties
    if (!this.schema.properties) {
      throw new Error('Could not find properties in root schema');
    }

    // Document root level
    this.lines.push('### Root Configuration');
    this.lines.push('');
    const rootProps = this.parseProperties(this.schema.properties, this.schema.required || []);
    this.lines.push(this.generateTable(rootProps, false, false));
    this.lines.push('');

    // Document agent object
    const agentSchema = this.schema.properties.agent;
    if (!agentSchema) {
      throw new Error('Could not find agent schema in root properties');
    }
    this.documentObject('agent', agentSchema);

    // Generate model capabilities table
    this.lines.push('### Supported Claude Models');
    this.lines.push('');
    this.lines.push('Models and their supported features:');
    this.lines.push('');
    this.lines.push(this.generateModelCapabilitiesTable());
    this.lines.push('');

    // Add cross-field validation rules (manual section)
    this.lines.push('### Cross-Field Validation Rules');
    this.lines.push('');
    this.lines.push('The following validation rules apply across multiple fields:');
    this.lines.push('');
    this.lines.push('1. **Thinking temperature constraint**');
    this.lines.push(
      '   When `agent.model.anthropic.thinking.type` is `"enabled"`, the `agent.model.anthropic.temperature` must be exactly `1.0`.',
    );
    this.lines.push(
      '   [Reference](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking)',
    );
    this.lines.push('');
    this.lines.push('2. **Thinking token budget**');
    this.lines.push(
      '   When thinking is enabled, `agent.model.anthropic.max_tokens` must be greater than `agent.model.anthropic.thinking.budget_tokens`.',
    );
    this.lines.push(
      '   [Reference](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size)',
    );
    this.lines.push('');
    this.lines.push('3. **Model capability validation**');
    this.lines.push('   - `web_search_20250305` tool requires a model that supports `web_search`');
    this.lines.push('   - `web_fetch_20250910` tool requires a model that supports `web_fetch`');
    this.lines.push('   - `thinking` configuration requires a model that supports `thinking`');
    this.lines.push('   - All models support `mcp` (MCP servers)');
    this.lines.push('');
    this.lines.push('   See the supported models table above for feature availability.');
    this.lines.push('');
    this.lines.push('### Additional Properties');
    this.lines.push('');
    this.lines.push('All objects in the configuration use `additionalProperties: false`, meaning:');
    this.lines.push('- No extra fields are allowed beyond those specified');
    this.lines.push('- Typos in field names will cause validation errors');
    this.lines.push('- This ensures configuration correctness and catches common mistakes');

    return this.lines.join('\n');
  }
}

// Main execution
const schemaPath = resolve(__dirname, '../../../config.schema.json');
const docsPath = resolve(__dirname, '../../../docs/schema-reference.mdx');

const parser = new SchemaParser(schemaPath);
const schemaReference = parser.generate();

writeFileSync(docsPath, schemaReference);

console.log('✅ Generated Schema Reference page');
console.log(`   Created: ${docsPath}`);
