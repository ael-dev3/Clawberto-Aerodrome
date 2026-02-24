from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path
import unittest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "aerodrome_pool_scan.py"
SPEC = importlib.util.spec_from_file_location("aerodrome_pool_scan", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load aerodrome_pool_scan.py")
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class AerodromePoolScanTests(unittest.TestCase):
    def test_official_eth_usdc_pool_hard_pins_to_ten(self) -> None:
        token_eth = module.TokenMeta(
            address=module.WETH_ADDRESS.lower(),
            symbol="WETH",
            name="Wrapped Ether",
            decimals=18,
            price_usd=2000.0,
            price_source="dexscreener",
        )
        token_usdc = module.TokenMeta(
            address=module.USDC_ADDRESS.lower(),
            symbol="USDC",
            name="USD Coin",
            decimals=6,
            price_usd=1.0,
            price_source="dexscreener",
        )

        score = module.score_pool(
            token0=token_eth,
            token1=token_usdc,
            liquidity_usd=10_000.0,
            volume_24h_usd=4_000.0,
            pair_created_ms=None,
            is_gauged=True,
            gauge_alive=True,
        )

        self.assertEqual(score["score"], 10.0)
        self.assertEqual(score["tier"], "high")

    def test_suspicious_metadata_penalizes_safety(self) -> None:
        scam = module.TokenMeta(
            address="0x1111111111111111111111111111111111111111",
            symbol="SCAMINU",
            name="Moon Rug Test",
            decimals=18,
            price_usd=1.0,
            price_source="dexscreener",
        )
        aero = module.TokenMeta(
            address=module.DEFAULT_AERO_TOKEN.lower(),
            symbol="AERO",
            name="Aero",
            decimals=18,
            price_usd=1.0,
            price_source="dexscreener",
        )

        score = module.score_pool(
            token0=scam,
            token1=aero,
            liquidity_usd=1_000.0,
            volume_24h_usd=0.0,
            pair_created_ms=None,
            is_gauged=False,
            gauge_alive=False,
        )

        self.assertLess(score["score"], 5.0)

    def test_apr_formulas_are_stable(self) -> None:
        reward_apr = module.compute_reward_apr_percent(0.125, 2.0, 250_000.0)
        fee_apr = module.compute_fee_apr_percent(100_000.0, 0.003, 250_000.0)
        bribe_apr = module.compute_bribe_apr_percent(12_000.0, 250_000.0)

        self.assertTrue(math.isclose(reward_apr, 3153.6, rel_tol=1e-9))
        self.assertTrue(math.isclose(fee_apr, 43.8, rel_tol=1e-9))
        self.assertTrue(math.isclose(bribe_apr, 249.6, rel_tol=1e-9))

    def test_parse_int_with_scientific_notation_output(self) -> None:
        self.assertEqual(module.parse_cast_uint("18594 [1.859e4]"), 18594)
        self.assertEqual(module.parse_cast_uint("0x04"), 4)

    def test_sort_rows_by_apr(self) -> None:
        rows = [
            {"pool_address": "a", "total_apr_pct": 1.2, "safety_score": 10.0, "liquidity_usd": 100.0},
            {"pool_address": "b", "total_apr_pct": 5.0, "safety_score": 8.0, "liquidity_usd": 100.0},
            {"pool_address": "c", "total_apr_pct": 3.4, "safety_score": 9.0, "liquidity_usd": 100.0},
        ]

        ordered = module.sort_rows(rows, "apr")
        self.assertEqual([r["pool_address"] for r in ordered], ["b", "c", "a"] )

    def test_pool_metadata_reads_reserves_not_decimals(self) -> None:
        class FakeCast:
            def __init__(self):
                self.calls = []
                self.pool = "0x2722c8f9b5e2ac72d1f225f8e8c990e449ba0078"
                self.factory = "0x420dd381b31aef6683db6b902084cb0ffece40da"
                self.token0 = "0x236aa50979d5f3de3bd1eeb40e81137f22ab794b"
                self.token1 = "0x4200000000000000000000000000000000000006"

            def call(self, to: str, signature: str, *args: str, **kwargs) -> str:
                self.calls.append((to, signature, args))
                if to == self.pool and signature == "metadata()(uint256,uint256,uint256,uint256,bool,address,address)":
                    return (
                        "1000000000000000000 [1e18]\n"
                        "999 [999]\n"
                        "500 [5e2]\n"
                        "250 [2.5e2]\n"
                        "false\n"
                        f"{self.token0}\n"
                        f"{self.token1}\n"
                    )
                if to == self.pool and signature == "factory()(address)":
                    return self.factory
                if to == self.pool and signature == "fee()(uint256)":
                    return "0"
                if to == self.factory and signature == "getFee(address,bool)(uint256)":
                    return "3000"
                return "0"

        cast = FakeCast()
        out = module.read_pool_market_data(cast, cast.pool)

        self.assertEqual(out["token0"], cast.token0)
        self.assertEqual(out["token1"], cast.token1)
        self.assertEqual(out["reserve0"], 500)
        self.assertEqual(out["reserve1"], 250)
        self.assertIsNone(out["decimals0"])
        self.assertIsNone(out["decimals1"])
        self.assertEqual(out["metadata_amp_factor"], 1_000_000_000_000_000_000)
        self.assertEqual(out["metadata_gamma"], 999)


if __name__ == "__main__":
    unittest.main()
