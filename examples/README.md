# Sniff Agent Configuration Examples

Real-world agent configurations demonstrating key features and use cases.

## Available Examples

### Issue Triage Agent

**File:** `triage-agent.yml`

Classifies, prioritizes, and labels incoming issues automatically.

**Features:**

- Low temperature (0.3) for consistent classification
- Structured output format
- Type, priority, and team routing

---

### Documentation Search Agent

**File:** `docs-search-agent.yml`

Answers technical questions by searching and analyzing documentation.

**Features:**

- Web search + web fetch tools
- Citations enabled
- Tool choice: auto

---

### Release Notes Generator

**File:** `release-notes-agent.yml`

Transforms closed issues into user-friendly release notes.

**Features:**

- Linear MCP integration
- Creative temperature (0.7)
- Categorizes changes by type

---

### Similar Issue Finder

**File:** `similar-issue-finder.yml`

Finds duplicate and related issues to consolidate work.

**Features:**

- Linear MCP for searching issues
- Lower temperature (0.4) for matching
- Identifies duplicates and past solutions

---

### Sprint Planning Assistant

**File:** `sprint-planning-agent.yml`

Analyzes issues for effort estimation and dependency detection.

**Features:**

- **Extended thinking enabled** (2000 token budget)
- Linear MCP integration
- Temperature: 1 (required for thinking)

---

### Technical Support Agent

**File:** `technical-support-agent.yml`

Answers questions using documentation and past support tickets.

**Features:**

- Web search + fetch for documentation
- **Linear MCP** for past tickets
- Combines multiple sources in one answer

---

## Getting Started

1. Copy an example to your project:

   ```bash
   cp examples/triage-agent.yml config.yml
   ```

2. Customize the system prompt and settings

3. Deploy:
   ```bash
   sniff deploy
   ```

## Key Configuration Options

**Temperature:**

- 0.3-0.5: Consistent, deterministic (triage, matching)
- 0.5-0.7: Balanced (docs, support)
- 0.7-0.9: Creative (release notes)

**Models:**

- `claude-haiku-4-5`: Fastest, most economical
- `claude-sonnet-4-5`: Best balance (recommended)
- `claude-opus-4-1`: Most capable

**Tools:**

- `web_search_20250305`: Find documentation pages
- `web_fetch_20250910`: Retrieve full page content

**MCP Servers:**

- `https://api.sniff.to/mcp/linear`: Access Linear issues

## Deploying Multiple Agents

```bash
# Deploy triage agent
cp examples/triage-agent.yml triage-config.yml
sniff deploy --config triage-config.yml

# Deploy docs agent
cp examples/docs-search-agent.yml docs-config.yml
sniff deploy --config docs-config.yml
```

## Need Help?

- [Documentation](https://docs.sniff.to)
- [Discord Community](https://discord.gg/huk9sSQCJA)
