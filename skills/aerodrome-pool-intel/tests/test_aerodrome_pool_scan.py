from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path
import unittest
from unittest import mock

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

    def test_normalize_token_filters(self) -> None:
        raw = [
            "0X4200000000000000000000000000000000000006",
            "0x4200000000000000000000000000000000000006",
            " 0x4200000000000000000000000000000000000007 ",
            "bad",
            "",
        ]
        out = module.normalize_token_filters(raw)
        self.assertEqual(
            out,
            [
                "0x4200000000000000000000000000000000000006",
                "0x4200000000000000000000000000000000000007",
            ],
        )

    def test_token_filter_matches(self) -> None:
        token0 = "0x4200000000000000000000000000000000000006"
        token1 = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        hits, any_hit, all_hit = module.token_filter_matches(
            token0,
            token1,
            ["0x4200000000000000000000000000000000000006"],
        )
        self.assertEqual(hits, ["0x4200000000000000000000000000000000000006"])
        self.assertTrue(any_hit)
        self.assertTrue(all_hit)

        hits, any_hit, all_hit = module.token_filter_matches(
            token0,
            token1,
            [
                "0x4200000000000000000000000000000000000006",
                "0x0000000000000000000000000000000000000000",
            ],
        )
        self.assertEqual(hits, ["0x4200000000000000000000000000000000000006"])
        self.assertTrue(any_hit)
        self.assertFalse(all_hit)

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

    def test_discover_pools_for_token_pair_prefers_stable_false_then_true(self) -> None:
        token_a = "0x767A739D1A152639e9Ea1D8c1BD55FDC5B217D7f"
        token_b = "0x4200000000000000000000000000000000000006"
        expected_pool = "0xf207d02beCD4417aAA3383804b6B87b17602c86D"
        factory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"

        class FakeCast:
            def __init__(self) -> None:
                self.calls = []

            def call(self, to: str, signature: str, *args: str, **kwargs) -> str:
                self.calls.append((to, signature, args))
                if to != factory:
                    return "0x0000000000000000000000000000000000000000"
                if signature == "getPool(address,address,bool)(address)":
                    ordered = args[0] == token_b.lower() and args[1] == token_a.lower()
                    if ordered and args[2] == "false":
                        return expected_pool
                return "0x0000000000000000000000000000000000000000"

        cast = FakeCast()
        pools = module.discover_pools_for_token_pair(
            cast=cast,
            factories=[factory],
            token_a=token_a,
            token_b=token_b,
        )

        self.assertEqual(pools, [expected_pool.lower()])
        call_sigs = [c[1] for c in cast.calls if c[0] == factory]
        self.assertIn("getPool(address,address,bool)(address)", call_sigs)

    def test_discover_pools_for_token_pair_collects_stable_variants(self) -> None:
        token_a = "0x767A739D1A152639e9Ea1D8c1BD55FDC5B217D7f"
        token_b = "0x4200000000000000000000000000000000000006"
        unstable_pool = "0xf207d02beCD4417aAA3383804b6B87b17602c86D"
        stable_pool = "0xaaaAa739D1A152639e9Ea1D8c1BD55FDC5B217D1"
        factory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"

        class FakeCast:
            def __init__(self) -> None:
                self.calls = []

            def call(self, to: str, signature: str, *args: str, **kwargs) -> str:
                self.calls.append((to, signature, args))
                if to != factory:
                    return "0x0000000000000000000000000000000000000000"
                if signature == "getPool(address,address,bool)(address)":
                    if args[2] == "false":
                        return unstable_pool
                    return stable_pool
                return "0x0000000000000000000000000000000000000000"

        cast = FakeCast()
        pools = module.discover_pools_for_token_pair(
            cast=cast,
            factories=[factory],
            token_a=token_a,
            token_b=token_b,
        )

        self.assertIn(unstable_pool.lower(), pools)
        self.assertIn(stable_pool.lower(), pools)

    def test_is_transient_rpc_error(self) -> None:
        self.assertTrue(module.is_transient_rpc_error("HTTP 429 Too Many Requests"))
        self.assertTrue(module.is_transient_rpc_error("gateway timeout from upstream provider"))
        self.assertTrue(module.is_transient_rpc_error("temporary failure in name resolution"))
        self.assertFalse(module.is_transient_rpc_error("execution reverted: custom revert"))

    def test_is_transient_http_error(self) -> None:
        err_429 = module.urllib.error.HTTPError(
            url="https://api.dexscreener.com/latest/dex/tokens/0x1",
            code=429,
            msg="Too Many Requests",
            hdrs=None,
            fp=None,
        )
        err_404 = module.urllib.error.HTTPError(
            url="https://api.dexscreener.com/latest/dex/tokens/0x1",
            code=404,
            msg="Not Found",
            hdrs=None,
            fp=None,
        )
        dns_err = module.urllib.error.URLError("temporary failure in name resolution")

        self.assertTrue(module.is_transient_http_error(err_429))
        self.assertFalse(module.is_transient_http_error(err_404))
        self.assertTrue(module.is_transient_http_error(dns_err))

    def test_retry_backoff_seconds_caps_at_max(self) -> None:
        cfg = module.RetryConfig(max_retries=4, base_delay_ms=100, max_delay_ms=250)
        self.assertTrue(math.isclose(module.retry_backoff_seconds(0, cfg), 0.1, rel_tol=1e-9))
        self.assertTrue(math.isclose(module.retry_backoff_seconds(1, cfg), 0.2, rel_tol=1e-9))
        self.assertTrue(math.isclose(module.retry_backoff_seconds(2, cfg), 0.25, rel_tol=1e-9))
        self.assertTrue(math.isclose(module.retry_backoff_seconds(8, cfg), 0.25, rel_tol=1e-9))

    def test_cast_call_retries_transient_error_then_succeeds(self) -> None:
        addr = module.WETH_ADDRESS.lower()
        run_results = [
            mock.Mock(returncode=1, stdout="", stderr="HTTP 429 Too Many Requests"),
            mock.Mock(returncode=0, stdout="123\n", stderr=""),
        ]
        with mock.patch.object(module.subprocess, "run", side_effect=run_results) as run_mock, mock.patch.object(
            module.time, "sleep"
        ) as sleep_mock:
            client = module.CastClient(
                module.DEFAULT_RPC_URL,
                timeout_sec=1,
                retry_config=module.RetryConfig(max_retries=2, base_delay_ms=1, max_delay_ms=10),
            )
            out = client.call(addr, "decimals()(uint8)", allow_fail=False, use_cache=False)

        self.assertEqual(out, "123")
        self.assertEqual(run_mock.call_count, 2)
        self.assertEqual(sleep_mock.call_count, 1)

    def test_cast_call_allow_fail_non_transient_error_returns_none_without_retry(self) -> None:
        addr = module.WETH_ADDRESS.lower()
        with mock.patch.object(
            module.subprocess,
            "run",
            return_value=mock.Mock(returncode=1, stdout="", stderr="execution reverted: bad call"),
        ) as run_mock, mock.patch.object(module.time, "sleep") as sleep_mock:
            client = module.CastClient(
                module.DEFAULT_RPC_URL,
                timeout_sec=1,
                retry_config=module.RetryConfig(max_retries=3, base_delay_ms=1, max_delay_ms=10),
            )
            out = client.call(addr, "decimals()(uint8)", allow_fail=True, use_cache=False)

        self.assertIsNone(out)
        self.assertEqual(run_mock.call_count, 1)
        self.assertEqual(sleep_mock.call_count, 0)

    def test_http_get_json_retries_transient_http_error(self) -> None:
        class FakeResponse:
            def __init__(self, body: bytes) -> None:
                self._body = body
                self._cursor = 0

            def read(self, n: int = -1) -> bytes:
                if self._cursor >= len(self._body):
                    return b""
                if n <= 0:
                    n = len(self._body) - self._cursor
                out = self._body[self._cursor : self._cursor + n]
                self._cursor += len(out)
                return out

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        err_429 = module.urllib.error.HTTPError(
            url="https://api.dexscreener.com/latest/dex/tokens/0x1",
            code=429,
            msg="Too Many Requests",
            hdrs=None,
            fp=None,
        )
        payload = b'{"pairs": []}'

        with mock.patch.object(
            module.urllib.request,
            "urlopen",
            side_effect=[err_429, FakeResponse(payload)],
        ) as open_mock, mock.patch.object(module.time, "sleep") as sleep_mock:
            out = module.http_get_json(
                "https://api.dexscreener.com/latest/dex/tokens/0x1111111111111111111111111111111111111111",
                timeout_sec=1.0,
                retry_config=module.RetryConfig(max_retries=1, base_delay_ms=1, max_delay_ms=5),
            )

        self.assertEqual(out, {"pairs": []})
        self.assertEqual(open_mock.call_count, 2)
        self.assertEqual(sleep_mock.call_count, 1)

    def test_http_get_json_does_not_retry_non_transient_http_error(self) -> None:
        err_404 = module.urllib.error.HTTPError(
            url="https://api.dexscreener.com/latest/dex/tokens/0x1",
            code=404,
            msg="Not Found",
            hdrs=None,
            fp=None,
        )

        with mock.patch.object(module.urllib.request, "urlopen", side_effect=err_404) as open_mock, mock.patch.object(
            module.time, "sleep"
        ) as sleep_mock:
            with self.assertRaises(module.urllib.error.HTTPError):
                module.http_get_json(
                    "https://api.dexscreener.com/latest/dex/tokens/0x1111111111111111111111111111111111111111",
                    timeout_sec=1.0,
                    retry_config=module.RetryConfig(max_retries=3, base_delay_ms=1, max_delay_ms=5),
                )

        self.assertEqual(open_mock.call_count, 1)
        self.assertEqual(sleep_mock.call_count, 0)



if __name__ == "__main__":
    unittest.main()
