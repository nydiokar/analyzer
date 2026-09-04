#!/usr/bin/env bash
# LEGACY: superseded by deployment/README.md and deploy.sh for Docker production.
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/home/luna/analyzer}"
PG_CONTAINER="${PG_CONTAINER:-analyzer-postgres}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PG_SUPER_PASS="${PG_SUPER_PASS:-}"
APP_DB_USER="${APP_DB_USER:-sova_app}"
APP_DB_NAME="${APP_DB_NAME:-sova_analyzer}"
APP_DB_PASS="${APP_DB_PASS:-}"

log() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker not found"
command -v node >/dev/null 2>&1 || fail "node not found"
command -v corepack >/dev/null 2>&1 || fail "corepack not found"

cd "$ROOT_DIR"
test -f package.json || fail "not in analyzer repo: $ROOT_DIR"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 24 ]; then
  fail "Node 24+ required (found $(node -v))"
fi

log "== Bootstrap: dependency install =="
corepack prepare pnpm@10.28.0 --activate >/dev/null
corepack pnpm install

log "== Bootstrap: prisma generate + build =="
corepack pnpm prisma generate
corepack pnpm build

log "== Bootstrap: redis container =="
docker compose --env-file .env up -d redis || docker compose up -d redis
for i in $(seq 1 20); do
  health="$(docker inspect --format '{{.State.Health.Status}}' analyzer-redis 2>/dev/null || true)"
  [ "$health" = "healthy" ] && break
  sleep 1
done
[ "${health:-}" = "healthy" ] || fail "analyzer-redis is not healthy"

log "== Bootstrap: postgres container =="
[ -n "$PG_SUPER_PASS" ] || PG_SUPER_PASS="$(openssl rand -hex 24)"
[ -n "$APP_DB_PASS" ] || APP_DB_PASS="$(openssl rand -hex 24)"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  docker run -d \
    --name "$PG_CONTAINER" \
    -e POSTGRES_PASSWORD="$PG_SUPER_PASS" \
    -p 127.0.0.1:5432:5432 \
    -v analyzer-pgdata:/var/lib/postgresql/data \
    postgres:16 >/dev/null
else
  docker start "$PG_CONTAINER" >/dev/null || true
fi

for i in $(seq 1 40); do
  if docker exec "$PG_CONTAINER" pg_isready -U "$PG_SUPERUSER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  [ "$i" -eq 40 ] && fail "postgres did not become ready"
done

if ! docker exec -e PGPASSWORD="$PG_SUPER_PASS" "$PG_CONTAINER" \
  psql -U "$PG_SUPERUSER" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
  fail "cannot authenticate to postgres superuser (PG_SUPER_PASS mismatch). Set PG_SUPER_PASS and rerun."
fi

ROLE_EXISTS="$(docker exec -e PGPASSWORD="$PG_SUPER_PASS" "$PG_CONTAINER" \
  psql -U "$PG_SUPERUSER" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_DB_USER';" | tr -d '[:space:]')"
if [ "$ROLE_EXISTS" = "1" ]; then
  docker exec -e PGPASSWORD="$PG_SUPER_PASS" "$PG_CONTAINER" \
    psql -U "$PG_SUPERUSER" -d postgres -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE $APP_DB_USER WITH LOGIN PASSWORD '$APP_DB_PASS';" >/dev/null
else
  docker exec -e PGPASSWORD="$PG_SUPER_PASS" "$PG_CONTAINER" \
    psql -U "$PG_SUPERUSER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE $APP_DB_USER LOGIN PASSWORD '$APP_DB_PASS';" >/dev/null
fi

DB_EXISTS="$(docker exec -e PGPASSWORD="$PG_SUPER_PASS" "$PG_CONTAINER" \
  psql -U "$PG_SUPERUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$APP_DB_NAME';" | tr -d '[:space:]')"
if [ "$DB_EXISTS" != "1" ]; then
  docker exec -e PGPASSWORD="$PG_SUPER_PASS" "$PG_CONTAINER" \
    psql -U "$PG_SUPERUSER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE $APP_DB_NAME OWNER $APP_DB_USER;" >/dev/null
fi

APP_TEST="$(docker exec -e PGPASSWORD="$APP_DB_PASS" "$PG_CONTAINER" \
  psql -U "$APP_DB_USER" -d "$APP_DB_NAME" -tAc 'select 1;' | tr -d '[:space:]')"
[ "$APP_TEST" = "1" ] || fail "app DB login test failed"

DATABASE_URL="postgresql://$APP_DB_USER:$APP_DB_PASS@127.0.0.1:5432/$APP_DB_NAME?connection_limit=30&pool_timeout=20&connect_timeout=10"

log ""
log "Bootstrap complete."
log "Use these values in .env:"
log "  DATABASE_URL=$DATABASE_URL"
log "  REDIS_URL=redis://:<your_redis_password>@127.0.0.1:6379"
log ""
log "Then run:"
log "  bash deployment/scripts/02-deploy.sh"
