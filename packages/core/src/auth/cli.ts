/**
 * CLI OAuth2 Authentication Helper
 *
 * Runs a temporary local server to handle the OAuth2 callback.
 */

import { createServer, type Server } from 'node:http';
import { createLinearOAuth, type LinearOAuthConfig } from './oauth.js';
import { handleAuthStart, handleAuthCallback } from '../server/auth.js';

export interface AuthResult {
  success: boolean;
  error?: string;
}

/**
 * Run the OAuth2 flow for Linear authentication
 *
 * 1. Starts a temporary local server
 * 2. Opens the authorization URL in the browser
 * 3. Handles the callback and exchanges the code for tokens
 * 4. Stores tokens in PostgreSQL
 */
export async function authenticateLinear(config: LinearOAuthConfig): Promise<AuthResult> {
  const port = new URL(config.redirectUri).port || '3000';
  const oauth = createLinearOAuth(config);

  return new Promise((resolve) => {
    const cleanup = (server: Server) => {
      server?.close();
    };

    const server: Server = createServer(async (req, res) => {
      const url = req.url || '';

      if (url === '/auth/linear' || url === '/') {
        handleAuthStart(req, res, {
          oauth,
          onSuccess: () => {
            cleanup(server);
            resolve({ success: true });
          },
        });
        return;
      }

      if (url.startsWith('/auth/linear/callback')) {
        await handleAuthCallback(req, res, {
          oauth,
          onSuccess: () => {
            cleanup(server);
            resolve({ success: true });
          },
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(parseInt(port, 10), () => {
      console.log(`\nOpen this URL in your browser to authenticate:`);
      console.log(`  http://localhost:${port}/auth/linear\n`);
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        cleanup(server);
        resolve({ success: false, error: 'Authentication timed out' });
      },
      5 * 60 * 1000,
    );
  });
}
