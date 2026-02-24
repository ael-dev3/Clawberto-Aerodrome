#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SKILL_DIR="$ROOT_DIR/skills/aerodrome-pool-intel"
OUT_DIR="${SCAN_OUT_DIR:-$ROOT_DIR/runs/aerodrome-heartbeat}"
mkdir -p "$OUT_DIR"

MAX_POOLS="${SCAN_MAX_POOLS:-120}"
WORKERS="${SCAN_WORKERS:-8}"
HTTP_WORKERS="${SCAN_HTTP_WORKERS:-6}"
SORT_BY="${SCAN_SORT_BY:-apr}"
MIN_LIQUIDITY="${SCAN_MIN_LIQUIDITY_USD:-0}"
ONLY_GAUGED="${SCAN_ONLY_GAUGED:-0}"
SCAN_LOOP="${SCAN_LOOP:-0}"
SCAN_LOOP_INTERVAL_SECONDS="${SCAN_LOOP_INTERVAL_SECONDS:-1800}"
SCAN_AUTO_REBALANCE="${SCAN_AUTO_REBALANCE:-0}"
SCAN_AUTO_REBALANCE_TOP_K="${SCAN_AUTO_REBALANCE_TOP_K:-5}"
SCAN_AUTO_REBALANCE_MIN_LIQUIDITY="${SCAN_AUTO_REBALANCE_MIN_LIQUIDITY:-0}"
SCAN_AUTO_REBALANCE_MIN_APR="${SCAN_AUTO_REBALANCE_MIN_APR:-0}"
SCAN_STRICT="${SCAN_STRICT:-0}"

if ! [[ "$SCAN_LOOP_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[heartbeat] SCAN_LOOP_INTERVAL_SECONDS must be integer seconds (got: $SCAN_LOOP_INTERVAL_SECONDS)" >&2
  exit 1
fi
if ! [[ "$SCAN_STRICT" =~ ^[01]$ ]]; then
  echo "[heartbeat] SCAN_STRICT must be 0 or 1 (got: $SCAN_STRICT)" >&2
  exit 1
fi

run_scan_once() {
  local timestamp
  timestamp="$(date -u +%Y%m%d-%H%M%S)"
  local tmp_json="$OUT_DIR/scan-${timestamp}.json"
  local tmp_csv="$OUT_DIR/scan-${timestamp}.csv"
  local log_file="$OUT_DIR/scan-${timestamp}.log"
  local scan_args=(
    --max-pools "$MAX_POOLS"
    --workers "$WORKERS"
    --http-workers "$HTTP_WORKERS"
    --sort-by "$SORT_BY"
    --out-json "$tmp_json"
    --out-csv "$tmp_csv"
  )

  if [ "$ONLY_GAUGED" = "1" ]; then
    scan_args+=(--only-gauged)
  fi
  if [ "$SCAN_STRICT" = "1" ]; then
    scan_args+=(--strict)
  fi
  if [ "$MIN_LIQUIDITY" != "0" ]; then
    scan_args+=(--min-liquidity-usd "$MIN_LIQUIDITY")
  fi

  echo "[heartbeat] scan started $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$log_file"
  python3 "$SKILL_DIR/scripts/aerodrome_pool_scan.py" "${scan_args[@]}" 2>&1 | tee -a "$log_file"

  cp "$tmp_json" "$OUT_DIR/latest.json"
  cp "$tmp_csv" "$OUT_DIR/latest.csv"

  if [ "$SCAN_AUTO_REBALANCE" = "1" ]; then
    python3 - "$tmp_json" "$SCAN_AUTO_REBALANCE_TOP_K" "$SCAN_AUTO_REBALANCE_MIN_LIQUIDITY" "$SCAN_AUTO_REBALANCE_MIN_APR" <<'PY' 2>&1 | tee -a "$log_file"
import json
import sys

path = sys.argv[1]
top_k = int(sys.argv[2])
min_liquidity = float(sys.argv[3])
min_apr = float(sys.argv[4])

with open(path, "r", encoding="utf-8") as fp:
    data = json.load(fp)

rows = data.get("rows") or []
candidates = [
    row for row in rows
    if (row.get("is_gauged") is True)
    and (row.get("liquidity_usd") or 0) >= min_liquidity
    and (row.get("total_apr_pct") or 0) >= min_apr
]
candidates.sort(
    key=lambda row: (
        row.get("total_apr_pct") or 0,
        row.get("safety_score") or 0,
        row.get("liquidity_usd") or 0,
    ),
    reverse=True,
)

print("[heartbeat] auto-rebalance candidates")
if not candidates:
    print("[heartbeat] no candidates met filters")
    raise SystemExit(0)

for row in candidates[:top_k]:
    pool = row.get("pool_address", "")
    token0 = row.get("token0_symbol") or "UNKNOWN0"
    token1 = row.get("token1_symbol") or "UNKNOWN1"
    apr = row.get("total_apr_pct") or 0
    safety = row.get("safety_score") or 0
    liq = row.get("liquidity_usd") or 0
    print(f"- {pool} ({token0}-{token1}) APR={apr:.2f}% safety={safety:.2f} liquidity={liq:.2f}")
PY
  fi

  echo "[heartbeat] scan finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$log_file"
  echo "[heartbeat] outputs: $OUT_DIR/latest.json, $OUT_DIR/latest.csv" | tee -a "$log_file"
}

while true; do
  run_scan_once
  if [ "$SCAN_LOOP" != "1" ]; then
    break
  fi
  sleep "$SCAN_LOOP_INTERVAL_SECONDS"
done
