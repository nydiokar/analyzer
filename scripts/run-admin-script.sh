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

exec docker compose --profile admin run --rm --build admin "$script_path" "$@"
