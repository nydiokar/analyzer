#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/home/luna/analyzer}"
STATE_FILE="${STATE_FILE:-/var/lib/analyzer-deploy/current-sha}"
REPOSITORY="${GITHUB_REPOSITORY:-nydiokar/analyzer}"
WORKFLOW="${DEPLOY_WORKFLOW:-production-deploy.yml}"
API_URL="${GITHUB_API_URL:-https://api.github.com}"
IMAGE_REPO="${APP_IMAGE_REPO:-ghcr.io/nydiokar/analyzer}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail 'curl is required'
command -v jq >/dev/null 2>&1 || fail 'jq is required'
[ -x "$ROOT_DIR/deployment/scripts/deploy.sh" ] || fail 'deploy.sh is missing or not executable'

api_args=(-fsS -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28')
if [ -n "${GITHUB_TOKEN:-}" ]; then
  api_args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi

workflow_url="$API_URL/repos/$REPOSITORY/actions/workflows/$WORKFLOW/runs?branch=main&status=success&per_page=1"
sha="$(curl "${api_args[@]}" "$workflow_url" | jq -r '.workflow_runs[0].head_sha // empty')"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail 'no successful production image workflow found'

current_sha=""
if [ -f "$STATE_FILE" ]; then
  current_sha="$(<"$STATE_FILE")"
fi
[ "$sha" != "$current_sha" ] || exit 0

cd "$ROOT_DIR"
APP_IMAGE_REPO="$IMAGE_REPO" ./deployment/scripts/deploy.sh "$sha"

install -d "$(dirname "$STATE_FILE")"
printf '%s\n' "$sha" > "$STATE_FILE"
