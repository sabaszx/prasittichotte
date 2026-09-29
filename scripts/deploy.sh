#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:?Provide ghcr image pinned to a commit SHA}"
DEPLOY_PATH="${2:-/opt/prasittichoke}"
[[ "$IMAGE" =~ ^ghcr.io/[a-z0-9._-]+/[a-z0-9._-]+:[a-f0-9]{40}$ ]] || { echo 'Invalid image'; exit 1; }
[[ "$DEPLOY_PATH" =~ ^/[a-zA-Z0-9/_-]+$ ]] || { echo 'Invalid deployment path'; exit 1; }
cd "$DEPLOY_PATH"
test -f .env
test -f compose.yaml
export IMAGE
compose=(docker compose -f compose.yaml)
if [[ -f deploy/Caddyfile ]] && grep -q '^APP_DOMAIN=.' .env; then
  compose+=(-f deploy/compose.proxy.yaml)
fi
old_container=$("${compose[@]}" ps -q app)
old_image=''
if [[ -n "$old_container" ]]; then
  old_image=$(docker inspect --format '{{.Config.Image}}' "$old_container")
  "${compose[@]}" exec -T app node scripts/backup.js
fi
"${compose[@]}" pull app
if "${compose[@]}" up -d --no-build --wait --wait-timeout 90; then
  printf '%s\n' "$IMAGE" > .deployed-image
  echo "Deployment healthy: $IMAGE"
else
  echo 'Deployment failed.'
  if [[ -n "$old_image" ]]; then
    export IMAGE="$old_image"
    "${compose[@]}" up -d --no-build --wait --wait-timeout 90
    echo 'Previous image restored. Database backup is retained; schema rollback is manual.'
  fi
  exit 1
fi
