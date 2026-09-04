#!/usr/bin/env bash
# LEGACY: superseded by deployment/README.md and deploy.sh for Docker production.
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/home/luna/analyzer}"
APP_NAME="${APP_NAME:-sova-backend-api}"

log() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

cd "$ROOT_DIR"
test -f .env || fail ".env not found"

required_vars=(
  HELIUS_API_KEY
  DATABASE_URL
  JWT_SECRET
  PASSWORD_PEPPER
  REDIS_PASSWORD
  REDIS_URL
)

for v in "${required_vars[@]}"; do
  if ! grep -Eq "^${v}=" .env; then
    fail "missing required env var: $v"
  fi
  value="$(grep -E "^${v}=" .env | tail -n1 | sed "s/^${v}=//")"
  [ -n "$value" ] || fail "empty required env var: $v"
done

log "== Deploy: schema migrate =="
corepack pnpm prisma migrate deploy

log "== Deploy: build =="
corepack pnpm build

log "== Deploy: PM2 start/restart =="
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  # Enforce the memory restart threshold on every deploy to avoid config drift.
  pm2 restart "$APP_NAME" --update-env --max-memory-restart 2G
else
  pm2 start ecosystem.backend.config.js --env production
fi
pm2 save

log "== Deploy: health checks =="
pm2 list
sleep 2
curl -fsS http://127.0.0.1:3001/api/v1/health >/dev/null
curl -fsS http://127.0.0.1:3001/api/v1/metrics >/dev/null
log "OK: backend healthy on 127.0.0.1:3001"
