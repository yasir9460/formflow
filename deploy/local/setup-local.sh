#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
if [[ -d data && -n "$(ls -A data)" ]]; then
  echo 'Existing data found. Use the release installer to preserve its recovery point.'
  exit 1
fi
mkdir -p data backups
export LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)"
docker compose -f docker-compose.local.yml build formflow
docker compose -f docker-compose.local.yml run --rm --no-deps formflow /app/node_modules/.bin/wrangler d1 execute DB --local --persist-to /data --config /app/dist/server/wrangler.json --command 'SELECT 1'
docker compose -f docker-compose.local.yml run --rm --no-deps formflow node /app/deploy/local/admin.mjs migrate
docker compose -f docker-compose.local.yml run --rm --no-deps formflow node /app/deploy/local/admin.mjs init "${1:-Super Administrator}"
docker compose -f docker-compose.local.yml up -d --force-recreate
echo 'Sign in as superadmin with the temporary password printed above; replace it immediately.'
