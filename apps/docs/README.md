# Sniff Documentation

This directory contains the Mintlify documentation for Sniff.

## Setup

Install dependencies:

```bash
pnpm install
```

## Development

Start the local preview server:

```bash
pnpm dev
```

This will open the docs at `http://localhost:3000` (defaults to dark mode).

To use a different port:

```bash
pnpm dev:port  # Uses port 3002
```

## Linting

Check for broken links:

```bash
pnpm lint
```

Check accessibility:

```bash
pnpm a11y
```

## Deployment

Docs are automatically deployed via Mintlify when pushed to the main branch.

## Structure

- `docs.json` - Mintlify configuration (defaults to dark mode)
- `introduction.mdx` - What is Sniff
- `quickstart.mdx` - Get started in 5 commands
- `how-it-works.mdx` - Agent lifecycle in Linear
- `configuration.mdx` - YAML reference
- `logo/` - Sniff logo files
- `favicon.png` - Site favicon
