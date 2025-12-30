# @sniff-dev/cli

Local-first AI agents for Linear. Run Claude-powered agents on your machine with full codebase access, triggered by Linear issues.

## What is Sniff?

Sniff connects Linear to AI agents running locally on your machine. When you apply a label or assign an issue, Sniff:

1. Receives the webhook via a cloud proxy
2. Creates an isolated git worktree for the issue
3. Runs Claude with full access to your codebase
4. Posts results back to Linear

**Key features:**
- **Local-first**: Agents run on your machine with unrestricted codebase access
- **Isolated execution**: Each issue gets its own git worktree
- **Zero database**: Config in YAML, tokens stored locally
- **MCP support**: Extend agents with Model Context Protocol servers

## Quick Start

```bash
# 1. Initialize config files
sniff init

# 2. Authenticate with Linear
sniff auth linear

# 3. Start the agent server
sniff start
```

## Commands

| Command | Description |
|---------|-------------|
| `sniff init` | Create `sniff.yml` configuration |
| `sniff validate` | Validate configuration |
| `sniff auth linear` | Authenticate with Linear via OAuth |
| `sniff start` | Start agent server |
| `sniff stop` | Instructions for stopping |
| `sniff status` | Show auth, server, and config status |
| `sniff logs` | View execution logs |

### Command Options

**sniff init**
- `-f, --force` - Overwrite existing config

**sniff validate**
- `-c, --config <path>` - Config file path (default: `sniff.yml`)

**sniff auth linear**
- `-f, --force` - Re-authenticate even if token exists
- `-p, --port <number>` - OAuth callback port

**sniff start**
- `-c, --config <path>` - Config file path
- `-v, --verbose` - Enable debug logging

**sniff logs**
- `-n, --lines <number>` - Number of lines (default: 50)
- `--issue <id>` - Filter by issue ID
- `--level <level>` - Filter by level (debug, info, warn, error)

## Configuration

Agents are defined in `sniff.yml`:

```yaml
version: "2.0"

agents:
  - id: engineer
    name: Engineer
    label: sniff  # Trigger when this label is applied
    systemPrompt: |
      You are a software engineer...
    runner:
      claude:
        allowedTools: [Read, Glob, Grep, Edit, Write, Bash]
        permissionMode: default
```

### Runner Options

```yaml
runner:
  claude:
    model: claude-sonnet-4-20250514  # Optional
    allowedTools: [...]              # Whitelist tools
    disallowedTools: [...]           # Blacklist tools
    permissionMode: default          # default|acceptEdits|bypassPermissions|plan
    maxTurns: 50                     # Conversation turn limit
    maxBudgetUsd: 5.0                # Cost limit
    maxThinkingTokens: 10000         # Extended thinking limit
    mcpServers:                      # MCP server definitions
      my-server:
        type: stdio
        command: node
        args: [server.js]
    env:                             # Environment variables
      MY_VAR: value
```

### MCP Servers

Sniff supports three MCP server types:

```yaml
mcpServers:
  # stdio - spawns a process
  my-stdio:
    type: stdio
    command: node
    args: [server.js]
    env:
      API_KEY: ${API_KEY}

  # sse - Server-Sent Events
  my-sse:
    type: sse
    url: http://localhost:8080/sse

  # http - HTTP transport
  my-http:
    type: http
    url: http://localhost:8080
```

**Note:** Linear MCP is auto-injected when you're authenticated, giving agents access to Linear's API.

## Environment Variables

All environment variables are optional with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `SNIFF_PROXY_URL` | `https://proxy.sniff.to` | Proxy URL for webhooks |
| `SNIFF_PORT` | `3847` | Local server port |
| `LINEAR_WEBHOOK_SECRET` | - | Webhook signature verification |
| `SNIFF_WORKTREE_ENABLED` | `true` | Git worktree isolation |

## How It Works

```
Linear Issue → Webhook → Cloud Proxy → WebSocket → Local CLI
                                                      ↓
                                              Git Worktree Created
                                                      ↓
                                              Claude Agent Runs
                                                      ↓
                                              Results → Linear
```

1. You apply a label (e.g., `sniff`) to an issue in Linear
2. Linear sends a webhook to the Sniff proxy
3. Proxy forwards it via WebSocket to your running CLI
4. CLI creates an isolated git worktree for the issue
5. Claude agent executes with full codebase access
6. Agent posts updates and results back to Linear

## Token Storage

Tokens are stored in:
- **Local**: `./.sniff/tokens/` (project-specific)
- **Global**: `~/.sniff/tokens/` (fallback)

Sniff automatically refreshes expired Linear tokens.
