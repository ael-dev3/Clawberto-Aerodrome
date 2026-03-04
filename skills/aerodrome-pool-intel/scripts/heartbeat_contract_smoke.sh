#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEARTBEAT_SCRIPT="$SCRIPT_DIR/heartbeat_aerodrome_scan.sh"

require_line() {
  local haystack="$1"
  local needle="$2"
  if ! grep -Fq -- "$needle" <<<"$haystack"; then
    echo "[FAIL] missing expected line: $needle" >&2
    return 1
  fi
}

run_with_retry() {
  local __out_var="$1"
  shift
  local attempt=1
  local max_attempts=3
  local sleep_s=1
  local out err_file err

  while [ "$attempt" -le "$max_attempts" ]; do
    err_file="$(mktemp /tmp/aerodrome_hb_smoke_err.XXXXXX)"
    if out="$("$@" 2>"$err_file")"; then
      rm -f "$err_file"
      printf -v "$__out_var" '%s' "$out"
      return 0
    fi

    err="$(cat "$err_file" 2>/dev/null || true)"
    rm -f "$err_file"

    if grep -Eiq 'rate[[:space:]]*limit|rate[[:space:]]*limited|\b429\b' <<<"$err" && [ "$attempt" -lt "$max_attempts" ]; then
      sleep "$sleep_s"
      sleep_s=$((sleep_s * 2))
      attempt=$((attempt + 1))
      continue
    fi

    echo "$err" >&2
    return 1
  done

  return 1
}

if [ ! -x "$HEARTBEAT_SCRIPT" ]; then
  echo "[FAIL] missing executable heartbeat script: $HEARTBEAT_SCRIPT" >&2
  exit 1
fi

tmp_json="$(mktemp /tmp/aerodrome_heartbeat_fixture.XXXXXX.json)"
trap 'rm -f "$tmp_json"' EXIT

cat >"$tmp_json" <<'JSON'
{
  "generated_at_utc": "2026-03-04T00:00:00+00:00",
  "inputs": {
    "pool_source_resolved": "metadata",
    "sort_by": "apr"
  },
  "protocol_summary": {
    "pool_count_scanned": 2,
    "gauged_pool_count": 1,
    "alive_gauge_count": 1,
    "total_liquidity_usd": 1600000.0,
    "total_volume_24h_usd": 240000.0
  },
  "rows": [
    {
      "pool_address": "0x1111111111111111111111111111111111111111",
      "token0_symbol": "AERO",
      "token1_symbol": "WETH",
      "total_apr_pct": 22.15,
      "safety_score": 8.7,
      "liquidity_usd": 1200000.0,
      "warnings": [],
      "errors": []
    },
    {
      "pool_address": "0x2222222222222222222222222222222222222222",
      "token0_symbol": "USDC",
      "token1_symbol": "AERO",
      "total_apr_pct": 7.4,
      "safety_score": 7.8,
      "liquidity_usd": 400000.0,
      "warnings": [
        "sample_warning"
      ],
      "errors": [
        "sample_error"
      ]
    }
  ]
}
JSON

echo "[1/2] contract output contract"
run_with_retry CONTRACT_OUT /bin/bash "$HEARTBEAT_SCRIPT" --from-json "$tmp_json" --contract
echo "$CONTRACT_OUT"

require_line "$CONTRACT_OUT" "mode:contract"
require_line "$CONTRACT_OUT" "generated_at_utc:"
require_line "$CONTRACT_OUT" "pool_source:"
require_line "$CONTRACT_OUT" "sort_by:"
require_line "$CONTRACT_OUT" "pool_count_scanned:"
require_line "$CONTRACT_OUT" "gauged_pool_count:"
require_line "$CONTRACT_OUT" "alive_gauge_count:"
require_line "$CONTRACT_OUT" "total_liquidity_usd:"
require_line "$CONTRACT_OUT" "total_volume_24h_usd:"
require_line "$CONTRACT_OUT" "top_pool_address:"
require_line "$CONTRACT_OUT" "top_pool_pair:"
require_line "$CONTRACT_OUT" "top_total_apr_pct:"
require_line "$CONTRACT_OUT" "top_safety_score:"
require_line "$CONTRACT_OUT" "top_liquidity_usd:"
require_line "$CONTRACT_OUT" "warning_row_count:"
require_line "$CONTRACT_OUT" "error_row_count:"
require_line "$CONTRACT_OUT" "latest_json:"
require_line "$CONTRACT_OUT" "latest_csv:"

echo "[2/2] highlight output contract"
run_with_retry HIGHLIGHT_OUT /bin/bash "$HEARTBEAT_SCRIPT" --from-json "$tmp_json" --highlight
echo "$HIGHLIGHT_OUT"

require_line "$HIGHLIGHT_OUT" "Aerodrome Heartbeat"
require_line "$HIGHLIGHT_OUT" "Scan:"
require_line "$HIGHLIGHT_OUT" "Top Pool:"
require_line "$HIGHLIGHT_OUT" "Risk:"
require_line "$HIGHLIGHT_OUT" "Outputs:"

echo "[PASS] heartbeat contract smoke checks passed"
