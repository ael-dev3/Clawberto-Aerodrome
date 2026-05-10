from __future__ import annotations

import importlib.util
import io
import json
import tempfile
from pathlib import Path
import unittest
from contextlib import redirect_stdout


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "hermes_lp_agent.py"
MATRIX_PATH = Path(__file__).resolve().parents[1] / "scripts" / "hermes_fixture_matrix.py"
SPEC = importlib.util.spec_from_file_location("hermes_lp_agent", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load hermes_lp_agent.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
MATRIX_SPEC = importlib.util.spec_from_file_location("hermes_fixture_matrix", MATRIX_PATH)
if MATRIX_SPEC is None or MATRIX_SPEC.loader is None:
    raise RuntimeError("Unable to load hermes_fixture_matrix.py")
matrix_module = importlib.util.module_from_spec(MATRIX_SPEC)
MATRIX_SPEC.loader.exec_module(matrix_module)


def base_config() -> dict:
    return {
        "name": "CL200-LFI-USDC",
        "pool_address": "0x8343c68279587498526114e6385f0a87f248e0d9",
        "gauge_address": "0xe9c73937382c621770f5b7018a407c0749df6aae",
        "nft_manager_address": "0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53",
        "token0": {"symbol": "LFI", "address": "0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3"},
        "token1": {"symbol": "USDC", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},
        "tick_spacing": 200,
        "managed_position": {"token_id": 341002},
        "ui_pool_info": {"tvl_usd": 33539.65},
        "strategy": {"min_headroom_ticks": 400, "min_headroom_pct": 0.15, "min_earned_aero_wei": "0"},
    }


def snapshot(current_tick: int, owner: str | None = None, depositor: str = "0x1111111111111111111111111111111111111111") -> dict:
    cfg = base_config()
    gauge = cfg["gauge_address"]
    return {
        "generated_at_utc": "2026-05-10T00:00:00Z",
        "source": "fixture",
        "chain_id": 8453,
        "pool": {"address": cfg["pool_address"], "tick": current_tick, "sqrt_price_x96": 1, "unlocked": True},
        "position": {
            "token_id": 341002,
            "owner": owner or gauge,
            "token0": cfg["token0"]["address"],
            "token1": cfg["token1"]["address"],
            "tick_spacing": 200,
            "tick_lower": -367400,
            "tick_upper": -365200,
            "liquidity": 8743302714174061,
            "tokens_owed0": 0,
            "tokens_owed1": 0,
        },
        "gauge": {
            "address": gauge,
            "reward_rate_wei_per_sec": 0,
            "left_wei": 0,
            "staked_contains": True if depositor else None,
            "earned_wei": 0 if depositor else None,
            "deposit_timestamp": 0 if depositor else None,
        },
        "depositor": depositor,
        "errors": [],
    }


class HermesLpAgentTests(unittest.TestCase):
    def test_in_range_position_holds(self) -> None:
        cfg = base_config()
        plan = module.evaluate(cfg, snapshot(-365900), module.load_thresholds(cfg), "propose")

        self.assertEqual(plan["decision"], "HOLD")
        self.assertEqual(plan["required_heartbeat_action"], "NONE")
        self.assertFalse(plan["blockers"])

    def test_out_of_range_requests_rebalance(self) -> None:
        cfg = base_config()
        plan = module.evaluate(cfg, snapshot(-365100), module.load_thresholds(cfg), "propose")

        self.assertEqual(plan["decision"], "UNSTAKE_REBALANCE_RESTAKE_REQUIRED")
        self.assertEqual(plan["required_heartbeat_action"], "REBALANCE_COMPOUND_RESTAKE")
        self.assertTrue(any(item["phase"] == "unstake" for item in plan["tx_plan"]))

    def test_missing_depositor_blocks_state_changing_rebalance(self) -> None:
        cfg = base_config()
        snap = snapshot(-365100, depositor="")
        snap["gauge"]["staked_contains"] = None
        plan = module.evaluate(cfg, snap, module.load_thresholds(cfg), "propose")

        self.assertEqual(plan["decision"], "MANUAL_REVIEW")
        self.assertIn("depositor required for rebalance plan", plan["blockers"])

    def test_unstaked_position_requests_stake_remediation(self) -> None:
        cfg = base_config()
        depositor = "0x1111111111111111111111111111111111111111"
        plan = module.evaluate(cfg, snapshot(-365900, owner=depositor, depositor=depositor), module.load_thresholds(cfg), "propose")

        self.assertEqual(plan["decision"], "STAKE_REMEDIATION_REQUIRED")
        self.assertEqual([item["phase"] for item in plan["tx_plan"]], ["approve-nft", "stake"])

    def test_cli_heartbeat_from_snapshot_writes_outputs(self) -> None:
        cfg = base_config()
        snap = snapshot(-365900)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            cfg_path = tmp_path / "config.json"
            snap_path = tmp_path / "snapshot.json"
            out_json = tmp_path / "plan.json"
            out_summary = tmp_path / "summary.txt"
            cfg_path.write_text(json.dumps(cfg), encoding="utf-8")
            snap_path.write_text(json.dumps(snap), encoding="utf-8")

            with redirect_stdout(io.StringIO()):
                code = module.main(
                    [
                        "heartbeat",
                        "--config",
                        str(cfg_path),
                        "--from-snapshot",
                        str(snap_path),
                        "--out-json",
                        str(out_json),
                        "--out-summary",
                        str(out_summary),
                    ]
                )

            self.assertEqual(code, 0)
            self.assertTrue(out_json.exists())
            self.assertTrue(out_summary.exists())
            payload = json.loads(out_json.read_text(encoding="utf-8"))
            self.assertEqual(payload["decision"], "HOLD")

    def test_contract_output_contains_guardrail_labels(self) -> None:
        cfg = base_config()
        plan = module.evaluate(cfg, snapshot(-365900), module.load_thresholds(cfg), "propose")
        out = module.render_contract(plan)

        self.assertIn("required heartbeat action:NONE", out)
        self.assertIn("range each side:", out)
        self.assertIn("stake integrity:PASS", out)
        self.assertIn("post-action tokenId/status:341002/HOLD", out)

    def test_fixture_matrix_covers_all_decision_branches(self) -> None:
        result = matrix_module.run_matrix()

        self.assertTrue(result["ok"])
        self.assertEqual(result["fixtures_checked"], 4)

    def test_contracts_payload_exposes_managed_pool_addresses(self) -> None:
        cfg = base_config()
        cfg["swap_router_address"] = "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F"
        cfg["quoter_address"] = "0x514c8B5f54112481E28028F1166Bd78501089259"
        payload = module.build_contracts_payload(cfg)

        self.assertEqual(payload["pool"], "0x8343c68279587498526114e6385f0a87f248e0d9")
        self.assertEqual(payload["gauge"], "0xe9c73937382c621770f5b7018a407c0749df6aae")
        self.assertEqual(payload["managed_token_id"], 341002)

    def test_health_command_is_json_capable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            cfg_path = tmp_path / "config.json"
            cfg_path.write_text(json.dumps(base_config()), encoding="utf-8")

            with redirect_stdout(io.StringIO()) as stdout:
                code = module.main(["health", "--config", str(cfg_path), "--json"])

            self.assertEqual(code, 0)
            payload = json.loads(stdout.getvalue())
            self.assertIn("cast_available", payload)
            self.assertIn("files", payload)


if __name__ == "__main__":
    unittest.main()
