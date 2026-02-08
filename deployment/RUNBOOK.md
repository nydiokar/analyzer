# Production Runbook

This runbook is optimized for first-time server bootstrap and repeatable redeploys.

## Preconditions

- Repo present at `/home/luna/analyzer`
- Domain DNS for API points to this server
- Cloudflare SSL mode set to `Full (strict)` after certificate is installed
- You have sudo access (`luna`)

## Phase 0: Baseline Health

```bash
pm2 list
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -fsS http://127.0.0.1:3001/api/v1/health || true
```

## Phase 1: Bootstrap Host + App

```bash
cd /home/luna/analyzer
bash deployment/scripts/01-bootstrap.sh
```

Expected:
- dependencies installed
- build succeeds
- `analyzer-redis` healthy
- `analyzer-postgres` running
- script prints a working `DATABASE_URL`

## Phase 2: Fill `.env`

Required keys:
- `HELIUS_API_KEY`
- `DATABASE_URL`
- `JWT_SECRET`
- `PASSWORD_PEPPER`
- `REDIS_PASSWORD`
- `REDIS_URL`

Notes:
- `DATABASE_URL` is the runtime DB source of truth.
- `POSTGRES_*` values are optional helper values, not app-required.

## Phase 3: Deploy App

```bash
cd /home/luna/analyzer
bash deployment/scripts/02-deploy.sh
```

Expected:
- migrations applied
- PM2 app online
- local health endpoint returns `200`

## Phase 4: Nginx

HTTP-only bootstrap:

```bash
sudo bash deployment/scripts/03-nginx.sh --domain api.sova-intel.com --http-only
```

TLS issue certificate:

```bash
sudo certbot --nginx -d api.sova-intel.com
```

Then apply TLS vhost:

```bash
sudo bash deployment/scripts/03-nginx.sh --domain api.sova-intel.com --enable-tls
```

Validation:

```bash
curl -i https://api.sova-intel.com/api/v1/health
```

## Phase 5: Observability

```bash
cd /home/luna/analyzer
bash deployment/scripts/04-observability.sh up
```

Validate targets:
- all scrape jobs should show `health":"up`

## Grafana Access

Server-local URL:
- `http://127.0.0.1:3000`

From desktop via SSH tunnel:

```bash
ssh -L 3000:127.0.0.1:3000 luna@<server_ip>
```

Reset admin password:

```bash
docker exec -it sova-grafana grafana cli admin reset-admin-password 'NEW_STRONG_PASSWORD'
```

## Rollback Guide

- Nginx:
  - restore backup from `/etc/nginx/nginx.conf.bak.<timestamp>`
  - restore site file backup if present
  - `sudo nginx -t && sudo systemctl reload nginx`
- PM2:
  - `pm2 restart sova-backend-api --update-env`
  - inspect logs: `pm2 logs sova-backend-api --lines 200`
- Observability:
  - `bash deployment/scripts/04-observability.sh down`

