# @sniff/cli

CLI for running local-first AI agents that integrate with Linear.

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize configuration files (`sniff.yml`, `.env.example`) |
| `validate` | Validate `sniff.yml` configuration |
| `auth <platform>` | Authenticate with Linear via OAuth |
| `start` | Start the agent server to listen for webhooks |
| `stop` | Instructions for stopping the server |
| `status` | Show system status (auth, server, config) |
| `logs` | View agent execution logs |

## Quick Start

1. Initialize: `sniff init`
2. Configure `.env` with your `SNIFF_PROXY_URL`
3. Authenticate: `sniff auth linear`
4. Start: `sniff start`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SNIFF_PROXY_URL` | Yes | Deployed proxy worker URL |
| `SNIFF_PORT` | No | Local server port (default: 3847) |
| `LINEAR_WEBHOOK_SECRET` | No | Webhook signature verification |

## Configuration

Agents are configured in `sniff.yml`. Run `sniff init` for a starter template.
