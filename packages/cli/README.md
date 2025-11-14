# @sniff-dev/cli

> Deploy AI agents to Linear in seconds

The official CLI for [Sniff](https://sniff.to) - the fastest way to deploy custom AI agents to Linear without building infrastructure.

[![npm version](https://img.shields.io/npm/v/@sniff-dev/cli.svg)](https://www.npmjs.com/package/@sniff-dev/cli)
[![License](https://img.shields.io/npm/l/@sniff-dev/cli.svg)](https://github.com/sniff-dev/sniff/blob/main/LICENSE)

## Why Sniff?

Linear supports AI agents, but building one requires:

- Setting up backend infrastructure to receive webhooks
- Handling OAuth flows with `actor=app`
- Managing AgentSession lifecycles
- Emitting AgentActivity with proper timing
- Dealing with GraphQL mutations
- Deploying and maintaining servers

**Sniff handles all of this for you.** Just write a config file and deploy.

## Features

- **Config-driven**: Define agents in YAML, version control everything
- **Lightning fast**: From zero to deployed agent in under 2 minutes
- **Multiple agents**: Deploy unlimited specialized agents, all appear as one Linear member
- **Secure**: OAuth managed by [Ampersand](https://withampersand.com) - your tokens never touch our servers
- **Powerful**: Built-in tools (web search, web fetch) + MCP integrations (Linear, GitHub, Slack)
- **Developer-friendly**: CLI-first, no UIs to click through

## Installation

```bash
npm install -g @sniff-dev/cli
```

**Requirements:** Node.js >= 20.0.0

## Quick Start

```bash
# 1. Authenticate with Sniff
sniff login

# 2. Initialize a new agent config
sniff init

# 3. Edit config.yml to customize your agent
# (Opens in your default editor or edit manually)

# 4. Deploy
sniff deploy
```

Your agent now appears as "@Sniff" in Linear! Mention it or assign issues to it.

## Commands

### `sniff login`

Authenticate with Sniff. Opens your browser to complete authentication.

```bash
sniff login
```

### `sniff logout`

Log out from Sniff and clear stored credentials.

```bash
sniff logout
```

### `sniff connect <provider>`

Connect integrations required for your agents.

```bash
# Connect Linear workspace (required)
sniff connect linear

# Connect Anthropic API key (required)
sniff connect anthropic
```

**Available providers:**

- `linear` - Connect your Linear workspace (OAuth)
- `anthropic` - Add your Anthropic API key

### `sniff init [agent-id]`

Create a new agent configuration file.

```bash
# Create config.yml in current directory
sniff init

# Create config for specific agent ID
sniff init triage-agent
```

This generates a `config.yml` template with example configuration.

### `sniff deploy`

Deploy or update an agent from `config.yml` in the current directory.

```bash
sniff deploy

# Deploy from a specific file
sniff deploy --config ./my-config.yml
```

The agent will be created or updated based on the `agent.id` in your config.

### `sniff list`

List all your deployed agents.

```bash
sniff list
```

Shows:

- Agent ID
- Agent name
- Description
- Model being used
- Last updated timestamp

### `sniff remove <agent-id>`

Delete a deployed agent.

```bash
sniff remove triage-agent
```

## Configuration

Example `config.yml`:

```yaml
version: '1.0'

agent:
  id: 'docs-agent'
  name: 'Docs Agent'
  description: 'Searches docs and answers questions'

  system_prompt: |
    You help users find answers in documentation.
    Search the web for relevant docs and provide clear answers.

  model:
    anthropic:
      name: 'claude-sonnet-4-5-20250929'
      tools:
        - type: web_search_20250305
          name: web_search
        - type: web_fetch_20250910
          name: web_fetch
      mcp_servers:
        - type: url
          url: https://api.sniff.to/mcp/linear
          name: Linear Integration
          tool_configuration:
            allowed_tools: ['searchIssues', 'getIssue']
```

See full configuration options in [our docs](https://docs.sniff.to)

## Security

**Your credentials never touch Sniff's servers.**

- Linear OAuth tokens are managed by [Ampersand](https://withampersand.com)
- Anthropic API keys are encrypted and stored securely
- All API calls are proxied through secure infrastructure
- Multi-tenant architecture with isolated data per user

## Debugging

Enable debug logging for any command:

```bash
sniff --debug deploy
sniff --debug connect linear
```

This shows detailed logs of API calls, authentication flows, and configuration parsing.

## Documentation

- **Docs**: [docs.sniff.to](https://docs.sniff.to)
- **Discord**: [Join our community](https://discord.gg/huk9sSQCJA)
- **npm**: [npmjs.com/package/@sniff-dev/cli](https://www.npmjs.com/package/@sniff-dev/cli)

## Support

- **Discord**: [discord.gg/huk9sSQCJA](https://discord.gg/huk9sSQCJA)

## License

MIT © Sniff
