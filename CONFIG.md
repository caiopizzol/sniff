# Sniff Configuration Specification v1.0

## Overview

The Sniff configuration file (`config.yml`) defines an AI agent's identity, behavior, and deployment settings. Version 1.0 focuses on a single agent deployed to Linear, with a minimal yet extensible structure.

## File Format

- **Format**: YAML
- **Encoding**: UTF-8
- **Location**: `./config.yml` (configurable via `CONFIG_FILE` env var)
- **Schema Version**: 1.0

## Environment Variable Interpolation

Configuration values can reference environment variables using the `${VAR_NAME}` syntax. This is useful for:

- Keeping secrets out of version control
- Different values per environment (dev/staging/prod)
- Third-party API keys and tokens

**Syntax**:

```yaml
# Required env var (error if not set)
api_key: ${API_KEY}

# Optional env var with default value
url: ${API_URL:-https://default.com}
name: ${AGENT_NAME:-Default Agent}
```

**Rules**:

- Environment variables must be UPPERCASE with underscores (`A-Z`, `0-9`, `_`)
- Use `${VAR_NAME}` for required variables (will error if not set)
- Use `${VAR_NAME:-default}` to provide a default value
- Interpolation happens before YAML parsing and validation
- Only string fields support interpolation (numbers, booleans must be literal)

**Security Best Practice**:

⚠️ **Never commit secrets to version control**. Use environment variables for sensitive data like API keys, tokens, and credentials. Store these in `.env` files (and add `.env` to `.gitignore`) or use your deployment platform's secrets management.

## Top-Level Structure

```yaml
version: '1.0' # Required
agent: {} # Required - Agent definition
```

## Field Specifications

### `version` (required)

**Type**: `string`  
**Pattern**: `"major.minor"`  
**Current**: `"1.0"`

Specifies the configuration schema version. Used for backwards compatibility and migration.

```yaml
version: '1.0'
```

---

### `agent` (required)

**Type**: `object`

Defines the agent's identity, behavior, and capabilities.

#### `agent.id` (required)

**Type**: `string`  
**Pattern**: `^[a-z0-9-]+$`  
**Length**: 1-50 characters

Unique identifier for the agent. Used for internal references and logging.

```yaml
agent:
  id: 'triage-bot'
```

#### `agent.name` (required)

**Type**: `string`  
**Length**: 1-100 characters

Human-readable display name for the agent.

```yaml
agent:
  name: 'Triage Assistant'
```

#### `agent.description` (optional)

**Type**: `string`  
**Length**: 0-500 characters

Brief description of the agent's purpose.

```yaml
agent:
  description: 'Analyzes and classifies engineering issues'
```

#### `agent.system_prompt` (required)

**Type**: `string`  
**Length**: 1-10000 characters

Core instructions that define how the agent thinks and responds. Sent to the LLM as the system message.

```yaml
agent:
  system_prompt: |
    You are a triage specialist for a development team.

    When analyzing an issue:
    1. Classify as BUG/FEATURE/QUESTION/TASK
    2. Set priority P0-P3
    3. Provide clear reasoning

    Respond in markdown format.
```

**Best Practices**:

- Be specific about the agent's role
- Define expected output format
- Include decision criteria
- Use markdown for formatting
- Keep under 2000 tokens for efficiency

#### `agent.model` (required)

**Type**: `object` (discriminated union)

Multi-provider model configuration. The provider key determines which LLM provider and configuration structure to use. Currently only Anthropic is supported, with OpenAI planned for future releases.

**Structure**:

```yaml
agent:
  model:
    anthropic: # Provider key (no separate "provider" field needed)
      name: 'claude-sonnet-4-5-20250929'
      temperature: 1.0
      max_tokens: 4096
      # ... other Anthropic-specific fields
```

### Anthropic Provider Configuration

When using `anthropic` as the provider key, the following fields are available:

##### `agent.model.anthropic.name` (required)

**Type**: `string`
**Known Models**:

- `claude-sonnet-4-5-20250929` (latest Sonnet)
- `claude-opus-4-1-20250805` (latest Opus)
- `claude-haiku-4-5-20251001` (latest Haiku)
- `claude-3-7-sonnet-20250219`
- `claude-sonnet-4-20250514`
- `claude-3-5-sonnet-20241022` (older, limited features)
- `claude-3-5-haiku-20241022` (older, limited features)

The specific Claude model to use. The configuration validates against known models and their capabilities.

```yaml
agent:
  model:
    anthropic:
      name: 'claude-sonnet-4-5-20250929'
```

##### `agent.model.anthropic.temperature` (optional)

**Type**: `number`
**Range**: `0.0 - 1.0`
**Default**: `1.0` (matches Anthropic's default)

Controls randomness in responses. Lower = more deterministic, Higher = more creative.

```yaml
agent:
  model:
    anthropic:
      temperature: 0.7
```

##### `agent.model.anthropic.max_tokens` (optional)

**Type**: `integer`
**Range**: `1 - 8192`
**Default**: `4096` (matches Anthropic's default)

Maximum tokens for the response.

```yaml
agent:
  model:
    anthropic:
      max_tokens: 4096
```

##### `agent.model.anthropic.top_p` (optional)

**Type**: `number`
**Range**: `0.0 - 1.0`
**Default**: `null`

Nucleus sampling parameter. Alternative to temperature for controlling randomness.

```yaml
agent:
  model:
    anthropic:
      top_p: 0.9
```

##### `agent.model.anthropic.top_k` (optional)

**Type**: `integer`
**Range**: `> 0`
**Default**: `null`

Top-k sampling removes "long tail" low probability responses. Advanced parameter, usually temperature is sufficient.

```yaml
agent:
  model:
    top_k: 40
```

##### `agent.model.stop_sequences` (optional)

**Type**: `array of strings`
**Max Items**: 10
**Default**: `null`

Custom stop sequences that halt generation when encountered.

```yaml
agent:
  model:
    stop_sequences:
      - 'END_ANALYSIS'
      - '---'
```

##### `agent.model.thinking` (optional)

**Type**: `object`
**Default**: `null`

Extended thinking configuration for complex reasoning tasks. Enables Claude to show its reasoning process before the final answer.

```yaml
agent:
  model:
    thinking:
      type: 'enabled'
      budget_tokens: 2000
```

**Requirements**:

- Minimum `budget_tokens`: 1024
- `temperature` must be 1 when thinking is enabled
- `max_tokens` must be greater than `budget_tokens`

##### `agent.model.metadata` (optional)

**Type**: `object`
**Default**: `null`

Metadata for tracking and abuse detection.

```yaml
agent:
  model:
    metadata:
      user_id: 'workspace-abc123' # Opaque identifier without PII
```

##### `agent.model.tool_choice` (optional)

**Type**: `object`
**Default**: `{ type: "auto" }`

Controls how the model uses tools.

**Options**:

```yaml
# Let Claude decide when to use tools
agent:
  model:
    tool_choice:
      type: 'auto'
      disable_parallel_tool_use: false # Optional
```

```yaml
# Force Claude to use at least one tool
agent:
  model:
    tool_choice:
      type: 'any'
```

```yaml
# Force use of a specific tool
agent:
  model:
    tool_choice:
      type: 'tool'
      name: 'web_search'
```

```yaml
# Disable tool use
agent:
  model:
    tool_choice:
      type: 'none'
```

**Fields**:

- `type` (required): One of `"auto"`, `"any"`, `"tool"`, or `"none"`
- `name` (required if type is `"tool"`): Name of the specific tool to use
- `disable_parallel_tool_use` (optional): Disable parallel tool execution

#### `agent.model.tools` (optional)

**Type**: `array`
**Default**: `[]`

List of tools the agent can actively invoke. Currently supports server-side tools executed by Anthropic's infrastructure.

**Web Search Tool** (`web_search_20250305`)

Allows the agent to search the web for information. Executed automatically by Anthropic and incurs usage-based fees in addition to token costs. See [Anthropic's tool use pricing](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use) for details.

**Supported Models**:

- Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- Claude Sonnet 3.7 (`claude-3-7-sonnet-20250219`)
- Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Claude Haiku 3.5 (`claude-3-5-haiku-latest`)
- Claude Opus 4.1 (`claude-opus-4-1-20250805`)
- Claude Opus 4 (`claude-opus-4-20250514`)

```yaml
agent:
  model:
    tools:
      - type: web_search_20250305
        name: web_search
        max_uses: 10 # Optional: limit searches per conversation
        allowed_domains: # Optional: only include these domains
          - 'docs.example.com'
          - 'example.com'
        blocked_domains: # Optional: filter out spam/malicious sites
          - 'spam.com'
          - 'malware.com'
        user_location: # Optional: localize search results
          type: approximate
          city: 'San Francisco'
          region: 'California'
          country: 'US'
          timezone: 'America/Los_Angeles'
```

**Fields**:

- `type` (required): Must be `"web_search_20250305"`
- `name` (required): Tool name, must be `"web_search"`
- `max_uses` (optional): Maximum number of searches per conversation (cost control)
- `allowed_domains` (optional): Array of domains to include in search results. When specified, only results from these domains will be returned
- `blocked_domains` (optional): Array of domains to exclude from searches (useful with allowed_domains or for filtering spam)
- `user_location` (optional): Object to localize search results
  - `type` (required): Must be `"approximate"`
  - `city` (optional): City name for localization
  - `region` (optional): Region/state name for localization
  - `country` (optional): Country code (e.g., "US", "GB") for localization
  - `timezone` (optional): Timezone (e.g., "America/Los_Angeles") for localization

**Use Cases**:

- Look up protocol specifications and RFCs
- Search for CVE information and security advisories
- Find IP reputation and threat intelligence
- Research error messages and technical documentation

**Pricing**: $10 per 1,000 searches + standard token costs

---

**Web Fetch Tool** (`web_fetch_20250910`)

Retrieves and processes content from specific URLs. The model autonomously decides which URLs to fetch based on search results or context. Executed by Anthropic's infrastructure (requires beta header).

**Supported Models**:

- Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- Claude Sonnet 3.7 (`claude-3-7-sonnet-20250219`)
- Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Claude Haiku 3.5 (`claude-3-5-haiku-latest`)
- Claude Opus 4.1 (`claude-opus-4-1-20250805`)
- Claude Opus 4 (`claude-opus-4-20250514`)

```yaml
agent:
  model:
    tools:
      - type: web_fetch_20250910
        name: web_fetch
        max_uses: 20 # Optional: limit fetches per conversation
        allowed_domains: # Optional: only fetch from these domains
          - 'docs.example.com'
          - 'example.com'
        blocked_domains: # Optional: never fetch from these domains
          - 'private.example.com'
        citations: # Optional: include source citations
          enabled: true
        max_content_tokens: 100000 # Optional: limit content size
```

**Fields**:

- `type` (required): Must be `"web_fetch_20250910"`
- `name` (required): Tool name, must be `"web_fetch"`
- `max_uses` (optional): Maximum number of fetches per conversation (cost control)
- `allowed_domains` (optional): Array of domains to allow fetching from. When specified, only URLs from these domains can be fetched
- `blocked_domains` (optional): Array of domains to block fetching from. URLs from these domains will not be fetched
- `citations` (optional): Object to enable source citations in responses
  - `enabled` (required): Boolean indicating whether to include citations
- `max_content_tokens` (optional): Maximum content size to retrieve (default: 100,000)

**Use Cases**:

- Extract content from specific documentation pages
- Read API reference documentation in detail
- Process technical blog posts and tutorials
- Retrieve changelog or release notes from known URLs

**Pricing**: Free (standard token costs only)

---

#### `agent.model.mcp_servers` (optional)

**Type**: `array`
**Default**: `[]`

List of MCP (Model Context Protocol) servers that provide integration-specific tools. MCP servers are authenticated via user context and connect to external services like Linear, GitHub, or Slack through OAuth.

**MCP Server Configuration**

```yaml
agent:
  model:
    mcp_servers:
      - type: url
        url: 'https://api.sniff.to/mcp/linear'
        name: 'Linear Integration'
        tool_configuration: # Optional
          enabled: true
          allowed_tools: # Optional: only enable specific tools
            - 'get_issue'
            - 'search_issues'
          # disabled_tools: ["list_issues"]  # Alternative: disable specific tools
```

**Fields**:

- `type` (required): Must be `"url"` (currently only URL-based MCP servers are supported)
- `url` (required): URL of the MCP server endpoint
- `name` (required): Human-readable name for the MCP server (1-100 characters)
- `authorization_token` (optional): Bearer token for authenticating with third-party MCP servers. **Use environment variables** for this field to avoid committing secrets
- `tool_configuration` (optional): Controls which tools from the MCP server are available
  - `enabled` (optional): Whether tools from this server are enabled (defaults to true)
  - `allowed_tools` (optional): Array of specific tool names to enable. When specified, only these tools will be available
  - `disabled_tools` (optional): Array of specific tool names to disable. All other tools will be available

**Available MCP Integrations**:

- **Linear** (`/mcp/linear`): Tools for querying and managing Linear issues
  - `get_issue`: Retrieve a specific issue by ID
  - `list_issues`: List issues with optional filtering
  - `search_issues`: Search issues by text query

**Authentication**:

- **Sniff MCP servers** (e.g., Linear, GitHub): Use user authentication context via OAuth. Users must connect their integration accounts before the agent can use these tools (e.g., `sniff connect linear`). No `authorization_token` needed - authentication is handled automatically.
- **Third-party MCP servers**: Require an `authorization_token` field with a Bearer token. Use environment variables to provide API keys securely (see examples below).

**Use Cases**:

- Query Linear issues within agent workflows
- Search for related bugs or features
- Retrieve issue details to provide context
- Future: GitHub pull requests, Slack messages, Notion pages

**Example: Linear Integration**

```yaml
agent:
  model:
    mcp_servers:
      - type: url
        url: 'https://api.sniff.to/mcp/linear'
        name: 'Linear Integration'
```

**Example: Multiple MCP Servers**

```yaml
agent:
  model:
    mcp_servers:
      - type: url
        url: 'https://api.sniff.to/mcp/linear'
        name: 'Linear Integration'
      - type: url
        url: 'https://api.sniff.to/mcp/github'
        name: 'GitHub Integration'
        tool_configuration:
          allowed_tools: ['search_issues', 'get_pull_request']
```

**Example: Third-Party MCP Server with Environment Variables**

For third-party MCP servers (like Ragie, custom knowledge bases, etc.), use environment variables to securely provide API credentials:

```yaml
agent:
  id: 'support-bot'
  name: 'Support Assistant'

  system_prompt: |
    You help users by searching the knowledge base.
    Always use the search_knowledge tool before answering.

  model:
    anthropic:
      name: 'claude-sonnet-4-5-20250929'

      mcp_servers:
        # Sniff's Linear integration (no token needed)
        - type: url
          url: 'https://api.sniff.to/mcp/linear'
          name: 'Linear Integration'

        # Third-party knowledge base (requires API key)
        - type: url
          url: '${RAGIE_MCP_URL:-https://api.ragie.ai/v1/mcp}'
          name: 'Knowledge Base'
          authorization_token: '${RAGIE_API_KEY}'
```

Then set the environment variables:

```bash
# .env file (DO NOT commit to version control!)
RAGIE_API_KEY=your_secret_api_key_here
RAGIE_MCP_URL=https://api.ragie.ai/v1/mcp  # Optional, uses default if not set
```

---

**Using Web Search + Web Fetch Together**

The most powerful pattern combines both tools:

1. **Web Search** finds relevant documentation URLs
2. **Web Fetch** retrieves full content from those URLs for detailed analysis

```yaml
agent:
  model:
    tool_choice:
      type: auto # Let Claude decide when to use each tool
    tools:
      # Discovery tool - find relevant pages
      - type: web_search_20250305
        name: web_search
        max_uses: 5
        blocked_domains: # Optional: filter out unwanted sites
          - 'spam.com'

      # Content extraction - model decides which URLs to fetch
      - type: web_fetch_20250910
        name: web_fetch
        max_uses: 10
        citations:
          enabled: true
```

**Example Workflow**:

1. User asks: "How do I use prompt caching with Claude?"
2. Agent uses `web_search` to find relevant documentation URLs
3. Agent uses `web_fetch` to retrieve full content from the best URLs
4. Agent synthesizes information from fetched content to answer the question

---

## Complete Example

### Minimal Configuration

```yaml
version: '1.0'

agent:
  id: 'triage-bot'
  name: 'Triage Assistant'

  system_prompt: |
    You are a triage specialist.
    Classify issues as BUG/FEATURE/QUESTION/TASK.
    Set priority P0-P3.

  model:
    anthropic:
      name: 'claude-sonnet-4-5-20250929'
```

### Full Configuration

```yaml
version: '1.0'

agent:
  id: 'triage-bot'
  name: 'Triage Assistant'
  description: 'Analyzes and classifies engineering issues for the team'

  system_prompt: |
    You are a triage specialist for a software development team.

    When analyzing an issue, follow these steps:

    1. **Classification**: Determine the issue type
       - BUG: Something is broken or not working as expected
       - FEATURE: Request for new functionality
       - QUESTION: User needs help or clarification
       - TASK: Maintenance, refactoring, or technical debt

    2. **Priority**: Assess urgency and impact
       - P0: Critical - System down, data loss, security issue
       - P1: High - Major functionality broken, blocking users
       - P2: Medium - Important but workaround exists
       - P3: Low - Nice to have, minor issue

    3. **Analysis**: Provide clear reasoning for your decisions

    4. **Next Steps**: Suggest specific actions for the team

    Format your response in clear markdown with headers for each section.
    Be concise but thorough. Base decisions only on available information.
    If information is insufficient, indicate what's needed.

  model:
    anthropic:
      name: 'claude-sonnet-4-5-20250929'
      temperature: 0.7
      max_tokens: 4096
```

### Configuration with Web Search

```yaml
version: '1.0'

agent:
  id: 'research-bot'
  name: 'Research Assistant'
  description: 'AI agent that can search the web for information'

  system_prompt: |
    You are a research assistant that helps analyze issues.

    When you need external information:
    - Search for CVE details and security advisories
    - Look up protocol specifications and RFCs
    - Find technical documentation and error messages

    Always cite your sources when using web search results.

  model:
    anthropic:
      name: 'claude-sonnet-4-5-20250929'
      temperature: 0.7
      max_tokens: 4096
      tool_choice:
        type: 'auto' # Let Claude decide when to search
      tools:
        - type: web_search_20250305
          name: web_search
          max_uses: 5 # Cost control
```

---

## Environment Variables

The following environment variables must be set:

| Variable            | Required | Description                                   |
| ------------------- | -------- | --------------------------------------------- |
| `ANTHROPIC_API_KEY` | Yes      | Anthropic API key for Claude                  |
| `CONFIG_FILE`       | No       | Path to config file (default: `./config.yml`) |

**Note**: Linear connections are managed through OAuth via Ampersand. API credentials are automatically handled after connecting your workspace using `sniff connect linear`.

---

## Validation Rules

1. **Version**: Must be exactly `"1.0"`
2. **Agent ID**: Must be unique, lowercase alphanumeric with hyphens
3. **System Prompt**: Cannot be empty, should be under 2000 tokens
4. **Model Name**: Must be a valid Anthropic model
5. **Temperature**: Must be between 0.0 and 1.0

---

## Migration Path

### From v1.0 to v2.0 (Future)

When v2.0 is released with multiple deployment targets:

**v1.0** (current):

```yaml
version: '1.0'
agent:
  # ... agent config
```

Connections are managed separately via CLI:

```bash
sniff connect linear  # OAuth authentication
sniff deploy          # Uses authenticated connection
```

**v2.0** (future):

```yaml
version: '2.0'
agent:
  # ... same agent config
deploy_to:
  - linear
  - slack
  - mcp:
      port: 3000
```

Multiple deployment targets will be supported from a single config.

---

## Schema Validation

The configuration is validated using Zod schema on startup. Validation errors will prevent the application from starting and provide clear error messages:

```
❌ Invalid configuration in config.yml

agent.model.temperature: Number must be between 0 and 1
agent.id: Must be lowercase alphanumeric with hyphens

Check your config.yml against this specification.
```

---

## Best Practices

1. **Keep It Simple**: Start with minimal configuration and add complexity only when needed
2. **Version Control**: Commit your `config.yml` to git (it contains no secrets)
3. **Environment-Specific**: Use different config files for dev/staging/prod
4. **Prompt Engineering**: Test system prompts thoroughly before production
5. **Model Selection**: Use Sonnet for balance of speed/quality, Opus for complex reasoning
6. **Temperature**: Use 0.3-0.5 for consistency, 0.7-0.9 for creativity
7. **Validation**: Run `sniff validate` to check config before deploying
8. **Tool Usage**:
   - Start without tools, add only when needed
   - Use `max_uses` to control costs for server-side tools
   - Test tool behavior with tool_choice "auto" before forcing tool use
   - Monitor token and tool usage costs
9. **Cost Management**:
   - Server-side tools incur usage fees beyond token costs
   - Set `max_uses` limits on expensive tools
   - Use `allowed_domains` to restrict web searches to trusted sources

---

## Common Patterns

### Issue Triage Agent

```yaml
system_prompt: |
  You are a triage specialist.
  Classify issues and set priorities.
  Focus on: classification, priority, reasoning, next steps.
```

### Documentation Assistant

```yaml
system_prompt: |
  You are a documentation expert.
  Identify gaps in documentation.
  Suggest improvements and additions.
```

### Bug Analyzer

```yaml
system_prompt: |
  You are a bug analysis expert.
  Identify root causes and patterns.
  Suggest fixes and preventive measures.
```

---

## Troubleshooting

### Config Not Found

```
❌ Config file not found at ./config.yml
Create it by running: cp config.example.yml config.yml
```

**Solution**: Create config.yml from the example template.

### Invalid YAML

```
❌ Invalid YAML syntax in config.yml
```

**Solution**: Check for proper indentation (2 spaces), quotes, and special characters.

### Schema Validation Failed

```
❌ Invalid configuration in config.yml
agent.model.name: Invalid enum value
```

**Solution**: Check field types and allowed values in this specification.

### Linear Connection Failed

```
❌ No Linear workspace connected
```

**Solution**: Connect your Linear workspace using `sniff connect linear`. This will start an OAuth flow to authenticate your workspace.

---

## Changelog

### Version 1.0 (Current Release)

- Single agent configuration
- Linear deployment target
- Anthropic model support
- Server-side tool support (web_search_20250305)
- System prompt configuration
- Extended thinking support
- Tool choice controls
- Agentic loop for tool execution

### Version 2.0 (Planned)

- Multiple agents support
- Multiple deployment targets (Linear, Slack, MCP)
- Knowledge sources
- Additional server-side tools (web_fetch, code_execution, bash)
- Custom client-side tools
- Advanced model configuration (fallbacks, retries)
- Tool result streaming

---

## References

- [Linear API Documentation](https://developers.linear.app)
- [Anthropic API Documentation](https://docs.anthropic.com)
- [YAML Specification](https://yaml.org/spec/1.2.2/)
- [Sniff Documentation](https://github.com/sniff-dev/sniff)
