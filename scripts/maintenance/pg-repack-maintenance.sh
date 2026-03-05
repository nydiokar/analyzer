#!/usr/bin/env bash
set -euo pipefail

# Low-risk physical reclaim workflow for PostgreSQL using pg_repack.
# Default scope repacks medium tables first; giant SwapAnalysisInput is excluded
# unless explicitly requested.

APPLY=false
INCLUDE_SWAP=false
MIN_FREE_GB=8
START_MIN_FREE_GB=10
WAIT_TIMEOUT=60
DB_USER="postgres"
DB_NAME="sova_analyzer"
DOCKER_PG_CONTAINER="analyzer-postgres"
LOG_FILE="/tmp/pg-repack-maintenance-$(date +%Y%m%d-%H%M%S).log"

TABLES=(
  "HeliusTransactionCache"
  "AnalysisResult"
  "TokenLot"
)

usage() {
  cat <<'EOF'
Usage:
  scripts/maintenance/pg-repack-maintenance.sh [options]

Options:
  --apply                    Execute pg_repack (default is preview only)
  --include-swap             Include heavy SwapAnalysisInput table (risky)
  --min-free-gb N            Abort if free disk falls below N during run (default: 8)
  --start-min-free-gb N      Require at least N GB free before start (default: 10)
  --wait-timeout N           pg_repack lock wait timeout seconds (default: 60)
  -h, --help                 Show this help

Examples:
  scripts/maintenance/pg-repack-maintenance.sh
  scripts/maintenance/pg-repack-maintenance.sh --apply
  scripts/maintenance/pg-repack-maintenance.sh --apply --include-swap --min-free-gb 12
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    --include-swap)
      INCLUDE_SWAP=true
      shift
      ;;
    --min-free-gb)
      MIN_FREE_GB="${2:-}"
      shift 2
      ;;
    --start-min-free-gb)
      START_MIN_FREE_GB="${2:-}"
      shift 2
      ;;
    --wait-timeout)
      WAIT_TIMEOUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "$INCLUDE_SWAP" == "true" ]]; then
  TABLES+=("SwapAnalysisInput")
fi

free_gb() {
  df -BG / | awk 'NR==2 {gsub("G","",$4); print $4}'
}

db_size_bytes() {
  docker exec "$DOCKER_PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc \
    "SELECT pg_database_size('$DB_NAME');"
}

table_size_bytes() {
  local table="$1"
  docker exec "$DOCKER_PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc \
    "SELECT pg_total_relation_size('public.\"$table\"');"
}

ensure_prereqs() {
  command -v docker >/dev/null 2>&1 || {
    echo "docker not found"
    exit 1
  }
  command -v pg_repack >/dev/null 2>&1 || {
    echo "pg_repack not found in PATH"
    echo "Install pg_repack first, then rerun."
    exit 1
  }
  docker ps --format '{{.Names}}' | grep -q "^${DOCKER_PG_CONTAINER}$" || {
    echo "Postgres container ${DOCKER_PG_CONTAINER} is not running."
    exit 1
  }
}

print_preflight() {
  echo "== pg_repack preflight =="
  echo "Timestamp: $(date -Is)"
  echo "Mode: $([[ "$APPLY" == "true" ]] && echo APPLY || echo PREVIEW)"
  echo "Tables: ${TABLES[*]}"
  echo "Free disk: $(free_gb)G"
  echo "DB size bytes: $(db_size_bytes)"
  for t in "${TABLES[@]}"; do
    echo "Table ${t} bytes: $(table_size_bytes "$t")"
  done
}

run_repack_table() {
  local table="$1"
  local free_now
  free_now="$(free_gb)"
  if (( free_now < MIN_FREE_GB )); then
    echo "Abort: free disk ${free_now}G is below MIN_FREE_GB=${MIN_FREE_GB}G"
    exit 1
  fi

  echo "----"
  echo "Repacking ${table} (free ${free_now}G)..."
  docker exec -u postgres "$DOCKER_PG_CONTAINER" \
    pg_repack \
    -d "$DB_NAME" \
    -t "\"$table\"" \
    --wait-timeout="$WAIT_TIMEOUT"
  echo "Completed ${table}"
}

ensure_prereqs
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

print_preflight

start_free="$(free_gb)"
if (( start_free < START_MIN_FREE_GB )); then
  echo "Abort: free disk ${start_free}G is below START_MIN_FREE_GB=${START_MIN_FREE_GB}G"
  exit 1
fi

if [[ "$APPLY" != "true" ]]; then
  echo "Preview only. Re-run with --apply to execute."
  echo "Log: $LOG_FILE"
  exit 0
fi

echo "Ensuring pg_repack extension exists..."
docker exec "$DOCKER_PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "CREATE EXTENSION IF NOT EXISTS pg_repack;"

for table in "${TABLES[@]}"; do
  run_repack_table "$table"
done

echo "== Post-run =="
echo "Free disk: $(free_gb)G"
echo "DB size bytes: $(db_size_bytes)"
echo "Log: $LOG_FILE"
