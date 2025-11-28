// packages/cli/src/commands/auth.ts
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

const DEFAULT_SERVER_URL = 'https://api.sniff.to';

function getServerUrl(): string {
  return process.env.SNIFF_SERVER_URL || DEFAULT_SERVER_URL;
}

export const auth = new Command('auth').description('Authenticate with Linear').addCommand(
  new Command('linear').description('Authenticate with Linear via OAuth2').action(async () => {
    const serverUrl = getServerUrl();
    const authUrl = `${serverUrl}/auth/linear`;

    console.log(chalk.cyan(authUrl) + '\n');
    openBrowser(authUrl);

    // Poll server to confirm auth completed
    const spinner = ora('Waiting for authorization...').start();
    const maxAttempts = 60; // 2 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`${serverUrl}/api/auth/status`);
        if (res.ok) {
          const data = (await res.json()) as { authenticated: boolean };
          if (data.authenticated) {
            spinner.succeed('Authenticated with Linear');
            process.exit(0);
          }
        }
      } catch {
        spinner.text = `Waiting for authorization... (server not reachable)`;
      }
    }
    spinner.fail('Timed out waiting for authorization');
    process.exit(1);
  }),
);
