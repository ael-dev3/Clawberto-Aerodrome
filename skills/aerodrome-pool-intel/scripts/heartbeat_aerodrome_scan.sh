#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SKILL_DIR="$ROOT_DIR/skills/aerodrome-pool-intel"
OUT_DIR="${SCAN_OUT_DIR:-$ROOT_DIR/runs/aerodrome-heartbeat}"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
TMP_JSON="$OUT_DIR/scan-${TIMESTAMP}.json"
TMP_CSV="$OUT_DIR/scan-${TIMESTAMP}.csv"
LOG_FILE="$OUT_DIR/scan-${TIMESTAMP}.log"

exec >> "$LOG_FILE" 2>&1

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
echo "[heartbeat] scan started $(timestamp)"

MAX_POOLS="${SCAN_MAX_POOLS:-120}"
WORKERS="${SCAN_WORKERS:-8}"
HTTP_WORKERS="${SCAN_HTTP_WORKERS:-6}"
SORT_BY="${SCAN_SORT_BY:-apr}"
MIN_LIQUIDITY="${SCAN_MIN_LIQUIDITY_USD:-0}"
ONLY_GAUGED="${SCAN_ONLY_GAUGED:-0}"
SCAN_ARGS=(
  --max-pools "$MAX_POOLS"
  --workers "$WORKERS"
  --http-workers "$HTTP_WORKERS"
  --sort-by "$SORT_BY"
  --strict
  --out-json "$TMP_JSON"
  --out-csv "$TMP_CSV"
)
if [ "$ONLY_GAUGED" = "1" ]; then
  SCAN_ARGS+=(--only-gauged)
fi
if [ "$MIN_LIQUIDITY" != "0" ]; then
  SCAN_ARGS+=(--min-liquidity-usd "$MIN_LIQUIDITY")
fi

python3 "$SKILL_DIR/scripts/aerodrome_pool_scan.py" "${SCAN_ARGS[@]}"

cp "$TMP_JSON" "$OUT_DIR/latest.json"
cp "$TMP_CSV" "$OUT_DIR/latest.csv"

echo "[heartbeat] scan finished $(timestamp)"
echo "[heartbeat] outputs: $OUT_DIR/latest.json, $OUT_DIR/latest.csv"
