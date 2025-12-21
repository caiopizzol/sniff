/**
 * status command - Show agent and tunnel status
 */

import { getEnvConfig } from '@sniff/core'
import { SNIFF_DIR, tokenStorage } from '@sniff/storage'
import { Command } from 'commander'

export const statusCommand = new Command('status')
  .description('Show agent and tunnel status')
  .action(async () => {
    const env = getEnvConfig()

    console.log('Sniff Status')
    console.log('============')
    console.log('')

    // Check config directory
    const { stat } = await import('node:fs/promises')
    try {
      await stat(SNIFF_DIR)
      console.log(`Config directory: ${SNIFF_DIR}`)
    } catch {
      console.log('Config directory: Not initialized')
      console.log('  Run: sniff auth linear')
    }

    console.log('')

    // Check authentication
    console.log('Authentication:')
    const hasLocalLinear = await tokenStorage.hasLocal('linear')
    const hasLinear = await tokenStorage.has('linear')
    if (hasLocalLinear) {
      console.log('  Linear: [OK] Authenticated (local)')
    } else if (hasLinear) {
      console.log('  Linear: [OK] Authenticated (global)')
    } else {
      console.log('  Linear: [X] Not authenticated')
    }

    console.log('')

    // Check if server is running
    console.log('Server:')
    try {
      const response = await fetch(`http://localhost:${env.port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) {
        console.log(`  Status: [OK] Sniffing on port ${env.port}`)
      } else {
        console.log('  Status: [X] Trail gone cold')
      }
    } catch {
      console.log('  Status: [X] Trail gone cold')
    }

    // Check sniff.yml
    console.log('')
    console.log('Configuration:')
    const configFile = Bun.file('sniff.yml')
    if (await configFile.exists()) {
      console.log('  sniff.yml: [OK] Found')
    } else {
      console.log('  sniff.yml: [X] Not found')
      console.log('  Run: sniff init')
    }
  })
