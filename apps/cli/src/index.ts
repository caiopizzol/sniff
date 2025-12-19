#!/usr/bin/env bun

/**
 * Sniff CLI - Local-first AI agents for Linear
 * @module @sniff-dev/cli
 */

import { Command } from 'commander'
import { authCommand } from './commands/auth'
import { initCommand } from './commands/init'
import { logsCommand } from './commands/logs'
import { startCommand } from './commands/start'
import { statusCommand } from './commands/status'
import { stopCommand } from './commands/stop'
import { validateCommand } from './commands/validate'

const program = new Command()

program.name('sniff').description('Local-first AI agents for Linear').version('0.1.0')

// Register commands
program.addCommand(initCommand)
program.addCommand(validateCommand)
program.addCommand(authCommand)
program.addCommand(startCommand)
program.addCommand(stopCommand)
program.addCommand(statusCommand)
program.addCommand(logsCommand)

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help()
}

// Parse and execute
program.parse()
