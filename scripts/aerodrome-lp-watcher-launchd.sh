#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.foundry/bin"
export HERMES_RPC_URL="${HERMES_RPC_URL:-https://base-rpc.publicnode.com}"
export HERMES_LP_EXECUTE=0
export HERMES_DISCOVERY_FORWARD_SCAN="${HERMES_DISCOVERY_FORWARD_SCAN:-0}"

REPO="/Users/marko/.openclaw/workspace/Clawberto-Aerodrome"
RUN_DIR="$REPO/runs/aerodrome-lp-supervisor"
mkdir -p "$RUN_DIR"
cd "$REPO"

printf '\n[%s] aerodrome deterministic watcher start\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node scripts/aerodrome-lp-watcher.mjs
printf '[%s] aerodrome deterministic watcher end\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
