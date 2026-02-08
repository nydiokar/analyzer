# LLM Deployment Contract

Use this contract for automated deployments on this server.

## Non-Negotiable Gates

1. Do not run migrations before DB connectivity succeeds.
2. Do not start PM2 before required env vars are present.
3. Do not enable TLS nginx config before certificate files exist.
4. Run post-change health checks after every phase.
5. Abort on first failed gate; do not continue in degraded state.

## Required Runtime Env Contract

- `HELIUS_API_KEY`
- `DATABASE_URL`
- `JWT_SECRET`
- `PASSWORD_PEPPER`
- `REDIS_PASSWORD`
- `REDIS_URL`

## Phase Execution Order

1. `deployment/scripts/01-bootstrap.sh`
2. `.env` completion by operator
3. `deployment/scripts/02-deploy.sh`
4. `deployment/scripts/03-nginx.sh --http-only`
5. `certbot --nginx -d <domain>`
6. `deployment/scripts/03-nginx.sh --enable-tls`
7. `deployment/scripts/04-observability.sh up`

## Minimal Verification Set

- `pm2 list` includes `sova-backend-api` online
- `curl -fsS http://127.0.0.1:3001/api/v1/health`
- `curl -fsS https://api.sova-intel.com/api/v1/health`
- `curl -fsS http://127.0.0.1:9090/-/healthy`

## Drift Checks

- pinned image versions must stay explicit (no `latest`)
- nginx config must preserve rate limit zone + websocket proxy headers
- PM2 ecosystem app name remains `sova-backend-api`

