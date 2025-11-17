// packages/cli/src/commands/deploy.ts
import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import { Config } from '../lib/config.js';
import { api } from '../lib/api.js';
import { parseAndValidateConfig } from '@sniff-dev/config';

/**
 * Extract required provider connections from MCP server configuration
 * Sniff-hosted MCP servers follow the pattern: {any-domain}/mcp/{provider}
 * where provider is one of: linear, github, slack, notion
 */
function extractRequiredProviders(config: any): string[] {
  const mcpServers = config.agent?.model?.anthropic?.mcp_servers || [];
  const validProviders = ['linear', 'github'];
  const providers = new Set<string>();
  const pattern = /\/mcp\/([^/?#]+)/;

  for (const server of mcpServers) {
    const match = server.url?.match(pattern);
    if (match) {
      const provider = match[1];
      if (validProviders.includes(provider)) {
        providers.add(provider);
      }
    }
  }

  return Array.from(providers);
}

export const deploy = new Command('deploy')
  .description('Deploy agent to Linear')
  .option('-c, --config <path>', 'Config file path', 'config.yml')
  .option('--dry-run', 'Validate without deploying')
  .action(async (options: { config: string; dryRun?: boolean }) => {
    const userConfig = new Config();
    const token = userConfig.get('token');

    if (!token) {
      console.error(chalk.red('✗ Not authenticated. Run `sniff login` first.'));
      process.exit(1);
    }

    // Check config file exists
    if (!existsSync(options.config)) {
      console.error(chalk.red(`✗ Config file not found: ${options.config}`));
      console.log(chalk.gray('\nRun `sniff init` to create a config file.'));
      process.exit(1);
    }

    const spinner = ora('Loading configuration...').start();

    try {
      // Load and parse YAML
      const yamlContent = readFileSync(options.config, 'utf-8');

      // Validate config
      spinner.text = 'Validating configuration...';
      const validConfig = parseAndValidateConfig(yamlContent);

      if (options.dryRun) {
        spinner.succeed('Configuration is valid');
        console.log(chalk.green('\n✓ Dry run successful'));
        return;
      }

      // Check required connections
      spinner.text = 'Checking connections...';
      const connections = await api.get<any[]>('/connections', token);

      const baseRequiredProviders = ['linear', 'anthropic'];
      const mcpRequiredProviders = extractRequiredProviders(validConfig);
      const allRequiredProviders = [
        ...new Set([...baseRequiredProviders, ...mcpRequiredProviders]),
      ];
      const missingProviders = allRequiredProviders.filter(
        (provider) => !connections.some((c) => c.provider === provider),
      );

      if (missingProviders.length > 0) {
        spinner.fail('Missing required connections');
        console.error(chalk.red('\n✗ The following connections are required:'));

        for (const provider of missingProviders) {
          const reason = baseRequiredProviders.includes(provider)
            ? '(required for platform)'
            : '(required by MCP server in config)';
          console.log(
            chalk.gray('  • Run'),
            chalk.cyan(`sniff connect ${provider}`),
            chalk.gray(reason),
          );
        }

        process.exit(1);
      }

      spinner.text = 'Deploying agent...';
      const linearConnection = connections.find((c) => c.provider === 'linear')!;
      const result = await api.post<{ agentId: string; updated?: boolean }>(
        '/agents',
        {
          config: validConfig,
          platform: 'linear',
          workspaceId: linearConnection.workspaceId,
        },
        token,
      );

      const action = result.updated ? 'updated' : 'deployed';
      spinner.succeed(`Agent "${chalk.cyan(validConfig.agent.name)}" ${action}`);

      console.log(
        '\n' + chalk.green('✓'),
        result.updated ? 'Update successful!' : 'Deployment successful!',
      );
      console.log(chalk.gray('  ID:'), result.agentId);
      console.log(chalk.gray('  Connection:'), linearConnection.workspaceId);
      console.log(chalk.gray('  Status:'), chalk.green('Active'));

      console.log('\n' + chalk.gray('Your agent is now listening for Linear events.'));
      console.log(chalk.gray('Create an issue in Linear to test it!'));
    } catch (error) {
      spinner.fail('Deployment failed');

      if ((error as any).name === 'ZodError') {
        console.error(chalk.red('\n✗ Invalid configuration:'));
        (error as any).issues.forEach((err: any) => {
          console.error(chalk.gray('  •'), `${err.path.join('.')}: ${err.message}`);
        });
      } else {
        console.error(chalk.red('\n✗'), (error as Error).message);
      }

      process.exit(1);
    }
  });
