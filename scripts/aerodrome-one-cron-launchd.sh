#!/usr/bin/env bash
set -euo pipefail

REPO="/Users/marko/.openclaw/workspace/Clawberto-Aerodrome"
RUN_DIR="$REPO/runs/aerodrome-one-cron"
mkdir -p "$RUN_DIR"
cd "$REPO"

printf '\n[%s] one-cron launchd executor retired; use com.clawberto.aerodrome.watcher plus Hermes 1m supervisor\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
