#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$SKILL_DIR/references/lfi-usdc-pool.json"
FIXTURE="$SKILL_DIR/tests/fixtures/hold-snapshot.json"
AGENT="$SCRIPT_DIR/hermes_lp_agent.py"

require_line() {
  local haystack="$1"
  local needle="$2"
  if ! grep -Fq -- "$needle" <<<"$haystack"; then
    echo "[FAIL] missing expected line: $needle" >&2
    return 1
  fi
}

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

echo "[hermes-smoke] summary output contract"
SUMMARY_OUT="$("$PYTHON_BIN" "$AGENT" heartbeat --config "$CONFIG" --from-snapshot "$FIXTURE" --output-mode summary)"
echo "$SUMMARY_OUT"
require_line "$SUMMARY_OUT" "Hermes LP heartbeat"
require_line "$SUMMARY_OUT" "- decision:"
require_line "$SUMMARY_OUT" "- required heartbeat action:"
require_line "$SUMMARY_OUT" "- range each side:"
require_line "$SUMMARY_OUT" "- ticks each side now:"
require_line "$SUMMARY_OUT" "- configured ticks each side:"
require_line "$SUMMARY_OUT" "- stake integrity:"
require_line "$SUMMARY_OUT" "- pending reward now:"
require_line "$SUMMARY_OUT" "- est apr:"

echo "[hermes-smoke] contract output contract"
CONTRACT_OUT="$("$PYTHON_BIN" "$AGENT" heartbeat --config "$CONFIG" --from-snapshot "$FIXTURE" --output-mode contract)"
require_line "$CONTRACT_OUT" "decision:"
require_line "$CONTRACT_OUT" "required heartbeat action:"
require_line "$CONTRACT_OUT" "range each side:"
require_line "$CONTRACT_OUT" "ticks each side now:"
require_line "$CONTRACT_OUT" "configured ticks each side:"
require_line "$CONTRACT_OUT" "min headroom:"
require_line "$CONTRACT_OUT" "stake integrity:"
require_line "$CONTRACT_OUT" "pending reward now:"
require_line "$CONTRACT_OUT" "est apr:"
require_line "$CONTRACT_OUT" "post-action tokenId/status:"

echo "[hermes-smoke] highlight output contract"
HIGHLIGHT_OUT="$("$PYTHON_BIN" "$AGENT" heartbeat --config "$CONFIG" --from-snapshot "$FIXTURE" --output-mode highlight)"
require_line "$HIGHLIGHT_OUT" "Heartbeat update"
require_line "$HIGHLIGHT_OUT" "Highlights:"
require_line "$HIGHLIGHT_OUT" "Key status:"
require_line "$HIGHLIGHT_OUT" "- Range each side:"
require_line "$HIGHLIGHT_OUT" "- Ticks each side now:"
require_line "$HIGHLIGHT_OUT" "- Pending reward now:"
require_line "$HIGHLIGHT_OUT" "- Est APR:"
require_line "$HIGHLIGHT_OUT" "Outcome:"

echo "[hermes-smoke] raw JSON output contract"
RAW_OUT="$("$PYTHON_BIN" "$AGENT" heartbeat --config "$CONFIG" --from-snapshot "$FIXTURE" --output-mode raw)"
printf '%s' "$RAW_OUT" | "$PYTHON_BIN" -m json.tool >/dev/null
require_line "$RAW_OUT" "\"decision\": \"HOLD\""
require_line "$RAW_OUT" "\"required_heartbeat_action\": \"NONE\""

echo "[PASS] hermes heartbeat contract smoke checks passed"
