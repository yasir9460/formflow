#!/usr/bin/env bash
set -euo pipefail
echo 'Full recovery restores both a saved application and its matching data.'
echo 'Use: bash deploy/local/rollback-local.sh /absolute/restore-point --restore-data'
echo 'For pre-0.5 releases also add --acknowledge-legacy-access. Current data is moved to a rescue folder first.'
exit 2
