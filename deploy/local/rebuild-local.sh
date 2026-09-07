#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo 'Creating a recovery point before rebuilding the current source. For downloaded updates, use apply-release.sh instead.'
exec python3 "$ROOT_DIR/deploy/local/release-manager.py" rebuild
