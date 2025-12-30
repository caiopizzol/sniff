/**
 * init command - Create a new sniff.yml config file
 */

import { Command } from 'commander'

const SNIFF_YML_TEMPLATE = `# Sniff Agent Configuration
# Documentation: https://github.com/caiopizzol/sniff

version: "2.0"

agents:
  - id: triage-agent
    name: Triage Agent
    systemPrompt: |
      You are a helpful triage agent. When assigned an issue:
      1. Analyze the issue description
      2. Identify the root cause if possible
      3. Suggest next steps or solutions
      4. Be concise and actionable

    runner:
      claude:
        allowedTools:
          - Read
          - Glob
          - Grep
`

export const initCommand = new Command('init')
  .description('Create a new sniff.yml configuration file')
  .option('-f, --force', 'Overwrite existing config file')
  .action(async (options) => {
    const configPath = 'sniff.yml'
    const configFile = Bun.file(configPath)

    if ((await configFile.exists()) && !options.force) {
      console.error('Error: sniff.yml already exists. Use --force to overwrite.')
      process.exit(1)
    }

    await Bun.write(configPath, SNIFF_YML_TEMPLATE)
    console.log('Created sniff.yml')

    console.log('')
    console.log('Next steps:')
    console.log('  1. Authenticate with Linear: sniff auth linear')
    console.log('  2. Customize sniff.yml with your agent configuration')
    console.log('  3. Start your agent: sniff start')
  })
