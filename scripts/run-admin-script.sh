#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: pnpm admin:run <script.ts> [args...]" >&2
  exit 2
fi

script_path="$1"
shift

case "$script_path" in
  scripts/*|prisma/*|src/scripts/*)
    ;;
  *)
    echo "Admin script must be under scripts/ or prisma/: $script_path" >&2
    exit 2
    ;;
esac

if [[ -z "${APP_IMAGE:-}" ]]; then
  APP_IMAGE="$(docker inspect --format '{{.Config.Image}}' sova-backend 2>/dev/null || true)"
  [ -n "$APP_IMAGE" ] || {
    echo "No deployed application image found; run deployment/scripts/deploy.sh first or set APP_IMAGE." >&2
    exit 1
  }
  export APP_IMAGE
fi

exec docker compose --profile admin run --rm admin "$script_path" "$@"
