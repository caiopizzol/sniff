# @sniff/proxy

Cloudflare Worker that bridges Linear and local Sniff agents. Handles webhook forwarding and OAuth authentication.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/linear` | POST | Receives Linear webhooks and forwards to local agent |
| `/auth/linear` | GET | Initiates OAuth flow with Linear |
| `/auth/linear/callback` | GET | Handles OAuth callback |
| `/health` | GET | Health check |

## Deployment

```bash
# Set required secrets
wrangler secret put LINEAR_CLIENT_ID
wrangler secret put LINEAR_CLIENT_SECRET

# Optional: webhook signature verification
wrangler secret put WEBHOOK_SECRET

# Deploy
npm run deploy
```

## Environment Variables

Configure in Cloudflare dashboard or via `wrangler.toml`:

| Variable | Description |
|----------|-------------|
| `TUNNEL_URL` | Local development tunnel URL (e.g., ngrok) |

## Local Development

```bash
npm run dev
```
