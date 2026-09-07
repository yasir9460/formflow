#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
case "${1:-}" in init|recover) ;; *) echo 'Usage: admin-account.sh init "Your name" OR admin-account.sh recover'; exit 2;; esac
export LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)"
docker compose -f docker-compose.local.yml stop formflow
trap 'docker compose -f docker-compose.local.yml start formflow' EXIT
docker compose -f docker-compose.local.yml run --rm --no-deps formflow node /app/deploy/local/admin.mjs "$@"
