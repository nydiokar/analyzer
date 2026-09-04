#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
IMAGE_REPO="${APP_IMAGE_REPO:-ghcr.io/nydiokar/analyzer}"
TAG="${1:-}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ -n "$TAG" ] || fail "usage: $0 <immutable-image-tag>"
[ "$TAG" != "latest" ] || fail "latest is not a deployment identity; pass a SHA tag"
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || fail "image tag must be a 40-character git SHA"
[ -f "$ROOT_DIR/.env" ] || fail "missing $ROOT_DIR/.env"

cd "$ROOT_DIR"
export APP_IMAGE="${IMAGE_REPO}:${TAG}"
export APP_IMAGE_TAG="$TAG"

if [ -n "${GHCR_TOKEN:-}" ]; then
  [ -n "${GHCR_USERNAME:-}" ] || fail "GHCR_USERNAME is required with GHCR_TOKEN"
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin >/dev/null
fi

printf '== Pulling %s ==\n' "$APP_IMAGE"
docker compose --profile admin pull app migrate admin
docker image inspect "$APP_IMAGE" >/dev/null

printf '%s\n' '== Starting database services =='
docker compose up -d postgres redis

printf '%s\n' '== Running migrations from the selected image =='
docker compose run --rm migrate

printf '%s\n' '== Starting application services =='
docker compose up -d

for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3001/api/v1/health >/dev/null; then
    break
  fi
  [ "$attempt" -eq 40 ] && fail 'backend health check did not pass'
  sleep 3
done

backend_status="$(docker inspect --format '{{.State.Health.Status}}' sova-backend 2>/dev/null || true)"
[ "$backend_status" = healthy ] || fail "sova-backend is not healthy (status: ${backend_status:-missing})"

revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$APP_IMAGE")"
printf 'OK: deployed %s\n' "$APP_IMAGE"
printf 'OK: image revision %s\n' "$revision"
