#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/home/luna/analyzer}"
OBS_DIR="$ROOT_DIR/ops/observability"
ENV_FILE="$ROOT_DIR/.env"
ACTION="${1:-status}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

cd "$OBS_DIR"
test -f docker-compose.yml || fail "missing $OBS_DIR/docker-compose.yml"
test -f "$ENV_FILE" || fail "missing $ENV_FILE"

case "$ACTION" in
  up)
    docker compose --env-file "$ENV_FILE" up -d
    ;;
  down)
    docker compose --env-file "$ENV_FILE" down
    ;;
  restart)
    docker compose --env-file "$ENV_FILE" down
    docker compose --env-file "$ENV_FILE" up -d
    ;;
  status)
    ;;
  *)
    fail "usage: $0 [up|down|restart|status]"
    ;;
esac

docker compose --env-file "$ENV_FILE" ps
echo "--- Prometheus targets ---"
curl -fsS 'http://127.0.0.1:9090/api/v1/targets' | tr ',' '\n' | \
  grep -E '"job"|"health"|"lastError"' | sed -n '1,180p'

echo "--- Access ---"
echo "Grafana:    http://127.0.0.1:3000"
echo "Prometheus: http://127.0.0.1:9090"
echo "SSH tunnel from desktop:"
echo "  ssh -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 luna@<server_ip>"

