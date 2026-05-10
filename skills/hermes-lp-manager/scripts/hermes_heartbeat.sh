#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SKILL_DIR="$ROOT_DIR/skills/hermes-lp-manager"
OUT_DIR="${HERMES_OUT_DIR:-$ROOT_DIR/runs/hermes-lp-manager}"
CONFIG_PATH="${HERMES_POOL_CONFIG:-$SKILL_DIR/references/lfi-usdc-pool.json}"
MODE="${HERMES_MODE:-propose}"
OUTPUT_MODE="${HERMES_OUTPUT_MODE:-summary}"
LOOP="${HERMES_LOOP:-0}"
LOOP_INTERVAL_SECONDS="${HERMES_LOOP_INTERVAL_SECONDS:-1800}"
TOKEN_ID="${HERMES_TOKEN_ID:-341002}"
DEPOSITOR="${HERMES_DEPOSITOR_ADDRESS:-}"
FROM_SNAPSHOT="${HERMES_FROM_SNAPSHOT:-}"

mkdir -p "$OUT_DIR"

usage() {
  cat <<'USAGE'
Usage: hermes_heartbeat.sh [--once] [--loop] [--from-snapshot PATH] [--mode observe|propose|execute] [--summary|--contract|--highlight|--raw]

Environment:
  HERMES_RPC_URL
  HERMES_TOKEN_ID
  HERMES_DEPOSITOR_ADDRESS
  HERMES_OUT_DIR
  HERMES_LOOP
  HERMES_LOOP_INTERVAL_SECONDS
  HERMES_MIN_HEADROOM_TICKS
  HERMES_MIN_HEADROOM_PCT
  HERMES_MIN_EARNED_AERO_WEI
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --once)
      LOOP="0"
      shift
      ;;
    --loop)
      LOOP="1"
      shift
      ;;
    --from-snapshot)
      if [ "$#" -lt 2 ]; then
        echo "[hermes] --from-snapshot requires a path" >&2
        exit 1
      fi
      FROM_SNAPSHOT="$2"
      shift 2
      ;;
    --mode)
      if [ "$#" -lt 2 ]; then
        echo "[hermes] --mode requires a value" >&2
        exit 1
      fi
      MODE="$2"
      shift 2
      ;;
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
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[hermes] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  observe|propose|execute) ;;
  *)
    echo "[hermes] invalid mode: $MODE" >&2
    exit 1
    ;;
esac
case "$OUTPUT_MODE" in
  summary|contract|highlight|raw) ;;
  *)
    echo "[hermes] invalid output mode: $OUTPUT_MODE" >&2
    exit 1
    ;;
esac

if ! [[ "$LOOP_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[hermes] HERMES_LOOP_INTERVAL_SECONDS must be integer seconds" >&2
  exit 1
fi

run_once() {
  local timestamp
  timestamp="$(date -u +%Y%m%d-%H%M%S)"
  local run_json="$OUT_DIR/hermes-${timestamp}.json"
  local run_summary="$OUT_DIR/hermes-${timestamp}.txt"
  local log_file="$OUT_DIR/hermes-${timestamp}.log"
  local args=(
    heartbeat
    --config "$CONFIG_PATH"
    --mode "$MODE"
    --output-mode "$OUTPUT_MODE"
    --out-json "$run_json"
    --out-summary "$run_summary"
  )

  if [ -n "$FROM_SNAPSHOT" ]; then
    args+=(--from-snapshot "$FROM_SNAPSHOT")
  else
    args+=(--token-id "$TOKEN_ID")
    if [ -n "$DEPOSITOR" ]; then
      args+=(--depositor "$DEPOSITOR")
    fi
  fi

  echo "[hermes] heartbeat started $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$log_file"
  python3 "$SKILL_DIR/scripts/hermes_lp_agent.py" "${args[@]}" 2>&1 | tee -a "$log_file"
  cp "$run_json" "$OUT_DIR/latest.json"
  cp "$run_summary" "$OUT_DIR/latest.txt"
  echo "[hermes] heartbeat finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$log_file"
  echo "[hermes] outputs: $OUT_DIR/latest.json, $OUT_DIR/latest.txt" | tee -a "$log_file"
}

while true; do
  run_once
  if [ "$LOOP" != "1" ]; then
    break
  fi
  sleep "$LOOP_INTERVAL_SECONDS"
done
