#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any, Dict


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
CORE_PATH = SCRIPT_DIR / "hermes_lp_agent.py"
CONFIG_PATH = SKILL_DIR / "references" / "lfi-usdc-pool.json"
FIXTURE_DIR = SKILL_DIR / "tests" / "fixtures"

EXPECTED = {
    "hold-snapshot.json": ("HOLD", "NONE"),
    "rebalance-snapshot.json": ("UNSTAKE_REBALANCE_RESTAKE_REQUIRED", "REBALANCE_COMPOUND_RESTAKE"),
    "stake-remediation-snapshot.json": ("STAKE_REMEDIATION_REQUIRED", "STAKE_REMEDIATION_REQUIRED"),
    "manual-review-snapshot.json": ("MANUAL_REVIEW", "MANUAL_REVIEW"),
}

SUMMARY_LABELS = [
    "- decision:",
    "- required heartbeat action:",
    "- range each side:",
    "- ticks each side now:",
    "- configured ticks each side:",
    "- stake integrity:",
    "- pending reward now:",
    "- est apr:",
]

CONTRACT_LABELS = [
    "decision:",
    "required heartbeat action:",
    "range each side:",
    "ticks each side now:",
    "configured ticks each side:",
    "min headroom:",
    "stake integrity:",
    "pending reward now:",
    "post-action tokenId/status:",
]

HIGHLIGHT_LABELS = [
    "Heartbeat update",
    "Highlights:",
    "Key status:",
    "- Range each side:",
    "- Ticks each side now:",
    "- Pending reward now:",
    "- Est APR:",
    "Outcome:",
]

ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
TX_STATUSES = {"blocked", "needs_simulation", "needs_parameters"}


def load_core():
    spec = importlib.util.spec_from_file_location("hermes_lp_agent", CORE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load hermes_lp_agent.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_labels(text: str, labels: list[str], fixture: str, mode: str) -> None:
    missing = [label for label in labels if label not in text]
    if missing:
        raise AssertionError(f"{fixture} {mode} missing labels: {', '.join(missing)}")


def validate_tx_intents(plan: Dict[str, Any], fixture: str) -> None:
    for idx, item in enumerate(plan.get("tx_plan") or []):
        missing = [key for key in ("phase", "target", "signature", "args", "sender", "status", "note") if key not in item]
        if missing:
            raise AssertionError(f"{fixture} tx_plan[{idx}] missing keys: {', '.join(missing)}")
        if not ADDRESS_RE.match(str(item["target"])):
            raise AssertionError(f"{fixture} tx_plan[{idx}] target is not a full address")
        if item["status"] not in TX_STATUSES:
            raise AssertionError(f"{fixture} tx_plan[{idx}] has unexpected status {item['status']!r}")
        if not isinstance(item["args"], list):
            raise AssertionError(f"{fixture} tx_plan[{idx}] args is not a list")


def run_matrix() -> Dict[str, Any]:
    core = load_core()
    config = core.load_config(CONFIG_PATH)
    thresholds = core.load_thresholds(config)
    results = []

    for fixture_name, (expected_decision, expected_action) in EXPECTED.items():
        fixture_path = FIXTURE_DIR / fixture_name
        snapshot = core.load_json(fixture_path)
        plan = core.evaluate(config, snapshot, thresholds, "propose")
        if plan["decision"] != expected_decision:
            raise AssertionError(f"{fixture_name} decision {plan['decision']} != {expected_decision}")
        if plan["required_heartbeat_action"] != expected_action:
            raise AssertionError(
                f"{fixture_name} action {plan['required_heartbeat_action']} != {expected_action}"
            )

        require_labels(core.render_output(plan, "summary"), SUMMARY_LABELS, fixture_name, "summary")
        require_labels(core.render_output(plan, "contract"), CONTRACT_LABELS, fixture_name, "contract")
        require_labels(core.render_output(plan, "highlight"), HIGHLIGHT_LABELS, fixture_name, "highlight")
        raw = core.render_output(plan, "raw")
        parsed = json.loads(raw)
        if parsed["decision"] != expected_decision:
            raise AssertionError(f"{fixture_name} raw JSON decision mismatch")
        validate_tx_intents(plan, fixture_name)
        results.append(
            {
                "fixture": fixture_name,
                "decision": plan["decision"],
                "required_heartbeat_action": plan["required_heartbeat_action"],
                "tx_plan_count": len(plan.get("tx_plan") or []),
            }
        )
    return {"ok": True, "fixtures_checked": len(results), "results": results}


def main() -> int:
    result = run_matrix()
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
