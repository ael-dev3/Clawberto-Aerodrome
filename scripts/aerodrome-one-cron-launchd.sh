#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.foundry/bin"
export HERMES_LP_EXECUTE=1
export HERMES_RPC_URL="${HERMES_RPC_URL:-https://base-rpc.publicnode.com}"
export HERMES_REBALANCE_COOLDOWN_SECONDS="${HERMES_REBALANCE_COOLDOWN_SECONDS:-600}"
export HERMES_MIN_POSITION_USD="${HERMES_MIN_POSITION_USD:-1}"
export HERMES_DASHBOARD_SYNC="${HERMES_DASHBOARD_SYNC:-0}"
export HERMES_INCLUDE_DASHBOARD_CANDIDATES="${HERMES_INCLUDE_DASHBOARD_CANDIDATES:-0}"
export HERMES_DISCOVERY_FORWARD_SCAN="${HERMES_DISCOVERY_FORWARD_SCAN:-250}"

REPO="/Users/marko/.openclaw/workspace/Clawberto-Aerodrome"
RUN_DIR="$REPO/runs/aerodrome-one-cron"
mkdir -p "$RUN_DIR"
cd "$REPO"

printf '\n[%s] one-cron launchd cycle start\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node scripts/aerodrome-one-cron-rebalance.mjs --cron
printf '[%s] one-cron launchd cycle end\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
