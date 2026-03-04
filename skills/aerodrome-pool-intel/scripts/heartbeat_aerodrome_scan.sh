#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SKILL_DIR="$ROOT_DIR/skills/aerodrome-pool-intel"
OUT_DIR="${SCAN_OUT_DIR:-$ROOT_DIR/runs/aerodrome-heartbeat}"
mkdir -p "$OUT_DIR"

HEARTBEAT_OUTPUT_MODE="${HEARTBEAT_OUTPUT_MODE:-summary}"
HEARTBEAT_NO_SCAN="${HEARTBEAT_NO_SCAN:-0}"
HEARTBEAT_SOURCE_JSON="${HEARTBEAT_SOURCE_JSON:-}"

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

usage() {
  cat <<'USAGE'
Usage: heartbeat_aerodrome_scan.sh [--summary|--contract|--highlight|--raw|--output-mode MODE] [--from-json PATH] [--no-scan]

Modes:
  summary   concise operator summary (default)
  contract  deterministic key:value lines for guardrails
  highlight human-scannable compact sections
  raw       full JSON report payload
USAGE
}

OUTPUT_MODE="$HEARTBEAT_OUTPUT_MODE"
NO_SCAN="$HEARTBEAT_NO_SCAN"
SOURCE_JSON="$HEARTBEAT_SOURCE_JSON"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --summary)
      OUTPUT_MODE="summary"
      shift
      ;;
    --contract)
      OUTPUT_MODE="contract"
      shift
      ;;
    --highlight)
      OUTPUT_MODE="highlight"
      shift
      ;;
    --raw)
      OUTPUT_MODE="raw"
      shift
      ;;
    --output-mode)
      if [ "$#" -lt 2 ]; then
        echo "[heartbeat] --output-mode requires a value" >&2
        exit 1
      fi
      OUTPUT_MODE="$2"
      shift 2
      ;;
    --from-json)
      if [ "$#" -lt 2 ]; then
        echo "[heartbeat] --from-json requires a path" >&2
        exit 1
      fi
      SOURCE_JSON="$2"
      NO_SCAN="1"
      shift 2
      ;;
    --no-scan)
      NO_SCAN="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[heartbeat] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$OUTPUT_MODE" in
  summary|contract|highlight|raw) ;;
  *)
    echo "[heartbeat] invalid output mode '$OUTPUT_MODE' (expected: summary|contract|highlight|raw)" >&2
    exit 1
    ;;
esac

if ! [[ "$SCAN_LOOP_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[heartbeat] SCAN_LOOP_INTERVAL_SECONDS must be integer seconds (got: $SCAN_LOOP_INTERVAL_SECONDS)" >&2
  exit 1
fi
if ! [[ "$SCAN_STRICT" =~ ^[01]$ ]]; then
  echo "[heartbeat] SCAN_STRICT must be 0 or 1 (got: $SCAN_STRICT)" >&2
  exit 1
fi
if ! [[ "$NO_SCAN" =~ ^[01]$ ]]; then
  echo "[heartbeat] HEARTBEAT_NO_SCAN must be 0 or 1 (got: $NO_SCAN)" >&2
  exit 1
fi

emit_mode_output() {
  local mode="$1"
  local json_path="$2"
  local latest_json="$3"
  local latest_csv="$4"
  python3 - "$mode" "$json_path" "$latest_json" "$latest_csv" <<'PY'
import json
import math
import sys

mode = sys.argv[1]
json_path = sys.argv[2]
latest_json = sys.argv[3]
latest_csv = sys.argv[4]

with open(json_path, "r", encoding="utf-8") as fp:
    report = json.load(fp)

rows = report.get("rows") or []
inputs = report.get("inputs") or {}
summary = report.get("protocol_summary") or {}
generated = report.get("generated_at_utc") or "n/a"

def to_float(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return 0.0
    return out if math.isfinite(out) else 0.0

def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)

def fmt_money(value):
    return f"{to_float(value):.2f}"

pool_count_scanned = to_int(summary.get("pool_count_scanned"), default=len(rows))
gauged_pool_count = to_int(summary.get("gauged_pool_count"))
alive_gauge_count = to_int(summary.get("alive_gauge_count"))
total_liquidity_usd = to_float(summary.get("total_liquidity_usd"))
total_volume_24h_usd = to_float(summary.get("total_volume_24h_usd"))

warning_rows = sum(1 for row in rows if row.get("warnings"))
error_rows = sum(1 for row in rows if row.get("errors"))

top = rows[0] if rows else {}
top_addr = str(top.get("pool_address") or "n/a")
top_symbol0 = str(top.get("token0_symbol") or "UNKNOWN0")
top_symbol1 = str(top.get("token1_symbol") or "UNKNOWN1")
top_pair = f"{top_symbol0}-{top_symbol1}"
top_apr = to_float(top.get("total_apr_pct"))
top_safety = to_float(top.get("safety_score"))
top_liquidity = to_float(top.get("liquidity_usd"))

if mode == "raw":
    print(json.dumps(report, indent=2, sort_keys=True))
    raise SystemExit(0)

if mode == "contract":
    lines = [
        "mode:contract",
        f"generated_at_utc:{generated}",
        f"pool_source:{inputs.get('pool_source_resolved') or 'n/a'}",
        f"sort_by:{inputs.get('sort_by') or 'n/a'}",
        f"pool_count_scanned:{pool_count_scanned}",
        f"gauged_pool_count:{gauged_pool_count}",
        f"alive_gauge_count:{alive_gauge_count}",
        f"total_liquidity_usd:{total_liquidity_usd:.6f}",
        f"total_volume_24h_usd:{total_volume_24h_usd:.6f}",
        f"top_pool_address:{top_addr}",
        f"top_pool_pair:{top_pair}",
        f"top_total_apr_pct:{top_apr:.6f}",
        f"top_safety_score:{top_safety:.6f}",
        f"top_liquidity_usd:{top_liquidity:.6f}",
        f"warning_row_count:{warning_rows}",
        f"error_row_count:{error_rows}",
        f"latest_json:{latest_json}",
        f"latest_csv:{latest_csv}",
    ]
    print("\n".join(lines))
    raise SystemExit(0)

if mode == "highlight":
    lines = [
        "Aerodrome Heartbeat",
        "Scan:",
        f"• Generated: {generated}",
        f"• Source/sort: {inputs.get('pool_source_resolved') or 'n/a'} / {inputs.get('sort_by') or 'n/a'}",
        f"• Pools scanned: {pool_count_scanned} (gauged {gauged_pool_count}, alive {alive_gauge_count})",
        "Top Pool:",
        f"• Address: {top_addr}",
        f"• Pair/APR/Safety: {top_pair} | {top_apr:.2f}% | {top_safety:.2f}",
        f"• Liquidity: ${fmt_money(top_liquidity)}",
        "Risk:",
        f"• Rows with warnings: {warning_rows}",
        f"• Rows with errors: {error_rows}",
        "Outputs:",
        f"• latest.json: {latest_json}",
        f"• latest.csv: {latest_csv}",
    ]
    print("\n".join(lines))
    raise SystemExit(0)

if mode == "summary":
    lines = [
        "Aerodrome heartbeat summary",
        f"- generated_at_utc: {generated}",
        f"- source/sort: {inputs.get('pool_source_resolved') or 'n/a'} / {inputs.get('sort_by') or 'n/a'}",
        f"- pools scanned: {pool_count_scanned} (gauged {gauged_pool_count}, alive {alive_gauge_count})",
        f"- protocol liquidity/volume24h: ${fmt_money(total_liquidity_usd)} / ${fmt_money(total_volume_24h_usd)}",
        f"- top pool: {top_addr} ({top_pair}) apr={top_apr:.2f}% safety={top_safety:.2f} liquidity=${fmt_money(top_liquidity)}",
        f"- warning/error rows: {warning_rows}/{error_rows}",
        f"- outputs: {latest_json}, {latest_csv}",
    ]
    print("\n".join(lines))
    raise SystemExit(0)

raise SystemExit(f"unsupported mode: {mode}")
PY
}

if [ "$NO_SCAN" = "1" ]; then
  source_json_path="${SOURCE_JSON:-$OUT_DIR/latest.json}"
  if [ ! -f "$source_json_path" ]; then
    echo "[heartbeat] no scan mode requested, but JSON report was not found: $source_json_path" >&2
    exit 1
  fi
  latest_json="$OUT_DIR/latest.json"
  latest_csv="$OUT_DIR/latest.csv"
  emit_mode_output "$OUTPUT_MODE" "$source_json_path" "$latest_json" "$latest_csv"
  exit 0
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
  emit_mode_output "$OUTPUT_MODE" "$tmp_json" "$OUT_DIR/latest.json" "$OUT_DIR/latest.csv" | tee -a "$log_file"

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
