// packages/cli/src/commands/auth.ts
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { authenticateLinear } from '@sniff-dev/core';

const DEFAULT_SERVER_URL = 'https://api.sniff.to';

function getDefaultRedirectUri(): string {
  const serverUrl = process.env.SNIFF_SERVER_URL || DEFAULT_SERVER_URL;
  return `${serverUrl.replace(/\/$/, '')}/auth/linear/callback`;
}

export const auth = new Command('auth').description('Authenticate with Linear').addCommand(
  new Command('linear')
    .description('Authenticate with Linear via OAuth2')
    .option('--client-id <id>', 'Linear OAuth app client ID (or LINEAR_CLIENT_ID env)')
    .option(
      '--client-secret <secret>',
      'Linear OAuth app client secret (or LINEAR_CLIENT_SECRET env)',
    )
    .option('--redirect-uri <uri>', 'OAuth redirect URI (or uses SNIFF_SERVER_URL)')
    .action(async (options: { clientId?: string; clientSecret?: string; redirectUri?: string }) => {
      const clientId = options.clientId || process.env.LINEAR_CLIENT_ID;
      const clientSecret = options.clientSecret || process.env.LINEAR_CLIENT_SECRET;
      const redirectUri = options.redirectUri || getDefaultRedirectUri();

      if (!clientId || !clientSecret) {
        console.error(chalk.red('Missing client credentials.'));
        console.error(chalk.gray('Set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET in .env'));
        console.error(chalk.gray('Or pass --client-id and --client-secret'));
        process.exit(1);
      }

      console.log(chalk.bold('\nLinear OAuth2 Authentication\n'));
      console.log(chalk.gray('This will open a browser window to authorize with Linear.'));
      console.log(chalk.gray('Your tokens will be stored in the database.\n'));

      const spinner = ora('Starting auth server...').start();

      try {
        spinner.text = 'Waiting for authorization...';
        spinner.info();
        console.log(chalk.gray(`Callback URL: ${redirectUri}\n`));

        const result = await authenticateLinear({
          clientId,
          clientSecret,
          redirectUri,
        });

        if (result.success) {
          console.log(chalk.green('\n✓ Successfully authenticated with Linear!'));
          console.log(
            chalk.gray(
              '\nYou can now start the Sniff server without setting LINEAR_ACCESS_TOKEN.\n',
            ),
          );
        } else {
          console.error(chalk.red(`\n✗ Authentication failed: ${result.error}\n`));
          process.exit(1);
        }
      } catch (error) {
        spinner.fail('Authentication failed');
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    }),
);
