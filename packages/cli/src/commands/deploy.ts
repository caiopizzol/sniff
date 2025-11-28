// packages/cli/src/commands/deploy.ts
import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import chalk from 'chalk';
import { loadConfig } from '@sniff-dev/config';

export const deploy = new Command('deploy')
  .description('Deploy agents to a remote Sniff server')
  .option('-c, --config <path>', 'Path to config file', 'sniff.yml')
  .option('-s, --server <url>', 'Server URL (or set SNIFF_SERVER_URL)')
  .action(async (options: { config: string; server?: string }) => {
    const configPath = options.config;

    // Check if config exists
    if (!existsSync(configPath)) {
      console.error(chalk.red(`Config file not found: ${configPath}`));
      process.exit(1);
    }

    // Validate config locally first
    try {
      loadConfig(configPath);
    } catch (error) {
      console.error(chalk.red(`Invalid configuration: ${configPath}`));
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    // Get server URL
    const serverUrl = options.server || process.env.SNIFF_SERVER_URL;
    if (!serverUrl) {
      console.error(chalk.red('No server URL provided.'));
      console.error(chalk.gray('Set SNIFF_SERVER_URL or use --server flag'));
      process.exit(1);
    }

    // Get API key if set
    const apiKey = process.env.SNIFF_API_KEY;

    // Read config file content
    const configContent = readFileSync(configPath, 'utf-8');

    // Deploy to server
    console.log(chalk.gray(`Deploying to ${serverUrl}...`));

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${serverUrl}/api/deploy`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ config: configContent }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 401) {
          console.error(chalk.red('Unauthorized. Check your SNIFF_API_KEY.'));
        } else {
          console.error(chalk.red(`Deploy failed: ${errorBody.error || response.statusText}`));
        }
        process.exit(1);
      }

      const result = (await response.json()) as { agents: Array<{ id: string; name: string }> };

      console.log(chalk.green('Deployed successfully!'));
      console.log('');
      console.log(chalk.bold('Agents:'));
      for (const agent of result.agents) {
        console.log(chalk.gray(`  - ${agent.name} (${agent.id})`));
      }
    } catch (error) {
      if ((error as Error).cause && String((error as Error).cause).includes('ECONNREFUSED')) {
        console.error(chalk.red(`Cannot connect to server: ${serverUrl}`));
      } else {
        console.error(chalk.red(`Deploy failed: ${(error as Error).message}`));
      }
      process.exit(1);
    }
  });
