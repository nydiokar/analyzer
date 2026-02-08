# Deployment Toolkit

This folder contains a phased, production-focused deployment toolkit for `analyzer`.

## Phases

1. `scripts/01-bootstrap.sh`
- Host + app bootstrap
- Dependency install/build
- Redis startup
- PostgreSQL scaffold (container + role + db)
- Prints a ready `DATABASE_URL`

2. `scripts/02-deploy.sh`
- Strict `.env` validation
- Prisma migrations
- PM2 start/restart
- Local health checks

3. `scripts/03-nginx.sh` (run with `sudo`)
- Creates/updates nginx vhost for API
- Supports `--http-only` bootstrap mode
- Validates and reloads nginx

4. `scripts/04-observability.sh`
- Starts/stops/checks Docker observability stack
- Verifies Prometheus targets

## Quick Start

```bash
cd /home/luna/analyzer
bash deployment/scripts/01-bootstrap.sh
# Fill .env using printed DATABASE_URL and your secrets
bash deployment/scripts/02-deploy.sh
sudo bash deployment/scripts/03-nginx.sh --domain api.sova-intel.com --enable-tls
bash deployment/scripts/04-observability.sh up
```

Read `deployment/RUNBOOK.md` for full guidance.

