#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ROOT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STATE_FILE="${STATE_FILE:-/var/lib/analyzer-deploy/current-sha}"
IMAGE_REPO="${APP_IMAGE_REPO:-ghcr.io/nydiokar/analyzer}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail 'docker is required'
[ -x "$ROOT_DIR/deployment/scripts/deploy.sh" ] || fail 'deploy.sh is missing or not executable'

printf '== Resolving latest published image through GHCR ==\n'
docker pull "${IMAGE_REPO}:latest" >/dev/null
sha="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${IMAGE_REPO}:latest")"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail 'GitHub returned an invalid workflow SHA'

current_sha=""
if [ -f "$STATE_FILE" ]; then
  current_sha="$(<"$STATE_FILE")"
fi
[ "$sha" != "$current_sha" ] || exit 0

cd "$ROOT_DIR"
APP_IMAGE_REPO="$IMAGE_REPO" ./deployment/scripts/deploy.sh "$sha"

install -d "$(dirname "$STATE_FILE")"
printf '%s\n' "$sha" > "$STATE_FILE"
