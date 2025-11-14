# Sniff - Deploy AI Agents to Linear in Seconds

> CLI-first, configuration as code, developer-friendly

Deploy production-ready AI agents to Linear with a simple CLI and YAML config. No infrastructure, no complexity.

## Quick Start

```bash
# Install CLI
npm install -g @sniff-dev/cli

# Log in and connect integrations
sniff login
sniff connect linear
sniff connect anthropic

# Create agent config
sniff init

# Deploy
sniff deploy
```

Done. Your agent is now responding to Linear issues.

## What It Does

When a Linear issue is created or updated:

1. **Agent receives webhook** → Sniff runtime processes it
2. **Fetches issue details** → Via OAuth proxy
3. **Analyzes with Claude** → Sends issue data to Anthropic
4. **Responds in Linear** → Posts agent response as comment

## Project Structure

This is a monorepo containing the open-source CLI tools and shared packages:

```
sniff/
├── packages/
│   ├── cli/                # @sniff-dev/cli - Command-line interface
│   ├── shared/             # @sniff-dev/shared - Shared TypeScript types
│   └── config/             # @sniff-dev/config - Config validation
├── docs/                   # Documentation (Mintlify)
└── examples/               # Example agent configurations
```

The backend API and web dashboard are hosted at [sniff.to](https://sniff.to).

## Configuration

Define your agent in `config.yml`:

```yaml
version: '1.0'

agent:
  id: 'triage-bot'
  name: 'Triage Assistant'

  system_prompt: |
    You are a triage specialist for an engineering team.

    When a new issue is created:
    1. Classify as: bug, feature, question, or task
    2. Set priority: P0 (critical), P1 (high), P2 (medium), P3 (low)
    3. Provide clear reasoning

    Be concise but thorough.

  model:
    anthropic:
      name: 'claude-3-5-sonnet-20241022'
      temperature: 0.7
      max_tokens: 2000
```

**To update:** Edit config, run `sniff deploy`. That's it.

## CLI Commands

```bash
# Authentication
sniff login             # Log in to Sniff
sniff logout            # Log out

# Connections
sniff connect linear    # Connect Linear workspace via OAuth
sniff connect github    # (Future) Connect GitHub

# Agent Management
sniff init [name]       # Create config.yml template
sniff deploy            # Deploy/update agent
sniff deploy --dry-run  # Validate config without deploying
sniff list              # List all deployed agents

# Development
sniff logs [agent] -f   # (Future) Stream agent logs
sniff remove [agent]    # (Future) Remove deployed agent
```

## Examples

See [examples/](examples/) directory for real-world agent configurations:

- **Triage Agent** - Auto-classify and prioritize issues
- **Docs Search** - Answer questions by searching documentation
- **Release Notes** - Generate user-friendly release notes
- **Similar Issue Finder** - Find duplicates and related issues
- **Sprint Planning** - Estimate effort and detect dependencies
- **Technical Support** - Answer questions using docs and past tickets

## Contributing

Contributions are welcome! This repo contains the CLI and shared packages.

### Development Setup

```bash
# Install dependencies
pnpm install

# Build packages
pnpm build

# Test CLI locally
cd packages/cli
pnpm dev --help
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## License

MIT

## Support

- **Documentation**: [docs.sniff.to](https://docs.sniff.to)
- **Discord**: [discord.gg/huk9sSQCJA](https://discord.gg/huk9sSQCJA)
- **Issues**: [github.com/sniff-dev/sniff/issues](https://github.com/sniff-dev/sniff/issues)
