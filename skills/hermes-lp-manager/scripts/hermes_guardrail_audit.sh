#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

pass_count=0
fail_count=0

pass() {
  echo "[PASS] $*"
  pass_count=$((pass_count + 1))
}

fail() {
  echo "[FAIL] $*"
  fail_count=$((fail_count + 1))
}

echo "Hermes guardrail audit"

if "$PYTHON_BIN" -m py_compile "$SCRIPT_DIR/hermes_lp_agent.py" "$SCRIPT_DIR/hermes_agent.py"; then
  pass "python scripts compile"
else
  fail "python script compilation failed"
fi

if "$PYTHON_BIN" -m json.tool "$SKILL_DIR/commands.manifest.json" >/dev/null; then
  pass "commands manifest parses"
else
  fail "commands manifest does not parse"
fi

if "$PYTHON_BIN" -m json.tool "$SKILL_DIR/references/lfi-usdc-pool.json" >/dev/null; then
  pass "pool config parses"
else
  fail "pool config does not parse"
fi

if "$PYTHON_BIN" -m json.tool "$SKILL_DIR/references/policy.defaults.json" >/dev/null; then
  pass "policy defaults parse"
else
  fail "policy defaults do not parse"
fi

if "$PYTHON_BIN" -m json.tool "$SKILL_DIR/references/tx-intent-schema.json" >/dev/null; then
  pass "tx intent schema parses"
else
  fail "tx intent schema does not parse"
fi

if "$PYTHON_BIN" -m unittest discover -s "$SKILL_DIR/tests"; then
  pass "unit tests"
else
  fail "unit tests failed"
fi

if "$PYTHON_BIN" "$SCRIPT_DIR/hermes_fixture_matrix.py" >/tmp/hermes_fixture_matrix.out; then
  pass "fixture decision/output matrix"
else
  fail "fixture decision/output matrix failed"
fi

if bash "$SCRIPT_DIR/hermes_contract_smoke.sh"; then
  pass "heartbeat output contract smoke"
else
  fail "heartbeat output contract smoke failed"
fi

if grep -Fq "HERMES_DEPOSITOR_ADDRESS" "$SKILL_DIR/references/openclaw-instance-porting.md"; then
  pass "porting doc names depositor requirement"
else
  fail "porting doc missing depositor requirement"
fi

if grep -Fq "dashboard" "$SKILL_DIR/references/dashboard-sync-contract.md" && \
   grep -Fq "After any future verified enter/exit/rebalance execution" "$SKILL_DIR/SKILL.md"; then
  pass "dashboard sync contract documented"
else
  fail "dashboard sync contract missing"
fi

if grep -Fq "runs/*/*.txt" "$REPO_ROOT/.gitignore"; then
  pass "runtime text artifacts ignored"
else
  fail "runtime text artifacts not ignored"
fi

echo "Audit result: pass=$pass_count fail=$fail_count"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
