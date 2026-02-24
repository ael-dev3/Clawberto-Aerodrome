#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
SKILL_DIR="$ROOT_DIR/skills/aerodrome-pool-intel"
OUT_DIR="$ROOT_DIR/runs/aerodrome-pool-intel"

DISCOVERY_MAX_FACTORIES="${SIM_DISCOVERY_MAX_FACTORIES:-1}"
DISCOVERY_MAX_POOLS_PER_FACTORY="${SIM_DISCOVERY_MAX_POOLS_PER_FACTORY:-10}"
SCAN_MAX_POOLS="${SIM_SCAN_MAX_POOLS:-4}"
SCAN_WORKERS="${SIM_SCAN_WORKERS:-2}"
SCAN_HTTP_WORKERS="${SIM_SCAN_HTTP_WORKERS:-2}"
SCAN_PROGRESS_EVERY="${SIM_SCAN_PROGRESS_EVERY:-1}"
SCAN_CAST_TIMEOUT="${SIM_SCAN_CAST_TIMEOUT:-6}"

mkdir -p "$OUT_DIR"

printf '[sim] running unit tests\n'
PYTHONUNBUFFERED=1 python3 -u -m unittest discover -s "$SKILL_DIR/tests" -p 'test_*.py'

printf '[sim] running discovery smoke\n'
PYTHONUNBUFFERED=1 python3 -u "$SKILL_DIR/scripts/discover_aerodrome_contracts.py" \
  --max-factories "$DISCOVERY_MAX_FACTORIES" \
  --max-pools-per-factory "$DISCOVERY_MAX_POOLS_PER_FACTORY" \
  --write-json "$OUT_DIR/sim_discovery.json" \
  --write-csv "$OUT_DIR/sim_discovery.csv"

printf '[sim] running live scan smoke\n'
PYTHONUNBUFFERED=1 python3 -u "$SKILL_DIR/scripts/aerodrome_pool_scan.py" \
  --max-pools "$SCAN_MAX_POOLS" \
  --workers "$SCAN_WORKERS" \
  --http-workers "$SCAN_HTTP_WORKERS" \
  --cast-timeout "$SCAN_CAST_TIMEOUT" \
  --skip-token-prices \
  --skip-market \
  --skip-bribes \
  --sort-by apr \
  --progress-every "$SCAN_PROGRESS_EVERY" \
  --strict \
  --out-json "$OUT_DIR/sim_scan.json" \
  --out-csv "$OUT_DIR/sim_scan.csv"

printf '[sim] running contract call smoke\n'
PYTHONUNBUFFERED=1 python3 -u "$SKILL_DIR/scripts/aerodrome_contract_call.py" \
  --to 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5 \
  --sig 'length()(uint256)' \
  --json > "$OUT_DIR/sim_contract_call.json"

printf '[sim] done\n'
