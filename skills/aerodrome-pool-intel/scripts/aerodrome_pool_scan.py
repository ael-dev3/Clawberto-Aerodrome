#!/usr/bin/env python3
"""Aerodrome pool intelligence scanner.

Discovers Aerodrome pools from on-chain factory registry, enriches with DexScreener
market data, computes APRs (reward, fee, bribe), scores safety, and writes ranked
JSON/CSV output for OpenClaw.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import re
from decimal import Decimal, InvalidOperation
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

DEFAULT_RPC_URL = "https://base-rpc.publicnode.com"
DEFAULT_VOTER = "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5"
DEFAULT_FACTORY_REGISTRY = "0x5C3F18F06CC09CA1910767A34a20F771039E37C0"
DEFAULT_VOTING_ESCROW = "0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4"
DEFAULT_REWARDS_DISTRIBUTOR = "0x227f65131A261548b057215bB1D5Ab2997964C7d"
DEFAULT_AERO_TOKEN = "0x940181a94A35A4569E4529A3CDfB74e38FD98631"
DEFAULT_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74D54e5b1Beb874E43"

DEX_PAIR_ENDPOINT = "https://api.dexscreener.com/latest/dex/pairs/base/{pair}"
DEX_TOKEN_ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens/{token}"
ALLOWED_HTTP_HOSTS = {"api.dexscreener.com"}
ALLOWED_RPC_HOSTS = {"base-rpc.publicnode.com", "base-mainnet.g.alchemy.com", "base-mainnet.infura.io", "base-mainnet.public.blastapi.io"}

USER_AGENT = "OpenClaw-Aerodrome-Pool-Intel/1.0"
ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
WETH_ADDRESS = "0x4200000000000000000000000000000000000006"
USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

OFFICIAL_WETH = {WETH_ADDRESS.lower()}
OFFICIAL_USDC = {USDC_ADDRESS.lower()}

DEFAULT_TIMEOUT_SEC = 30
DEFAULT_HTTP_TIMEOUT_SEC = 10
MAX_HTTP_BYTES = 12 * 1024 * 1024
SECONDS_PER_YEAR = 365 * 24 * 60 * 60
SECONDS_PER_WEEK = 7 * 24 * 60 * 60

KNOWN_DECIMALS = {
    DEFAULT_AERO_TOKEN.lower(): 18,
    WETH_ADDRESS.lower(): 18,
    USDC_ADDRESS.lower(): 6,
}

SUSPICIOUS_TOKEN_RE = re.compile(r"(?:SCAM|RUG|PUMP|INU|FAKE|HONE|MELT)", re.IGNORECASE)
PAIR_LOOKUP_STABLE_OPTIONS = ("false", "true")


@dataclass
class TokenMeta:
    address: str
    symbol: str
    name: str
    decimals: int
    price_usd: Optional[float]
    price_source: Optional[str]


@dataclass
class PairMarket:
    dex_id: Optional[str]
    pair_url: Optional[str]
    liquidity_usd: float
    volume_h24_usd: float
    txns_h24: int
    pair_created_at_ms: Optional[int]
    base_token_address: Optional[str]
    base_token_symbol: Optional[str]
    base_token_name: Optional[str]
    quote_token_address: Optional[str]
    quote_token_symbol: Optional[str]
    quote_token_name: Optional[str]


def now_iso_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def normalize_address(value: Any) -> str:
    text = str(value or "").strip()
    if text.startswith("0X"):
        text = "0x" + text[2:]
    return text.lower() if ADDRESS_RE.match(text) else ""


def is_nonzero_address(value: str) -> bool:
    return bool(value) and value != ZERO_ADDRESS


def normalize_token_filters(raw_filters: Sequence[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for raw in raw_filters:
        addr = normalize_address(raw)
        if not addr or addr in seen:
            continue
        out.append(addr)
        seen.add(addr)
    return out


def token_filter_matches(token0: str, token1: str, token_filters: Sequence[str]) -> Tuple[List[str], bool, bool]:
    if not token_filters:
        return [], False, False
    token_set = {normalize_address(token0), normalize_address(token1)}
    hits = [addr for addr in token_filters if addr in token_set]
    return hits, bool(hits), len(hits) >= len(token_filters)


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator


def make_allowed_https_url(url: str, hosts: Sequence[str]) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Only https URLs are supported, got: {url}")
    host = (parsed.hostname or "").lower()
    if host not in hosts:
        raise ValueError(f"Blocked host '{host}' for URL: {url}")
    return url


def http_get_json(url: str) -> Any:
    safe_url = make_allowed_https_url(url, ALLOWED_HTTP_HOSTS)
    req = urllib.request.Request(
        safe_url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=DEFAULT_HTTP_TIMEOUT_SEC) as resp:
        total = 0
        chunks: List[bytes] = []
        while True:
            chunk = resp.read(65_536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_HTTP_BYTES:
                raise ValueError(f"HTTP payload exceeded {MAX_HTTP_BYTES} bytes")
            chunks.append(chunk)
    return json.loads(b"".join(chunks).decode("utf-8"))


def parse_cast_uint(raw: str) -> int:
    first_token = (raw or "").strip().splitlines()[0].strip()
    first_token = first_token.split()[0] if first_token else ""
    if not first_token:
        return 0
    if first_token.startswith("0x"):
        return int(first_token, 16)
    try:
        return int(first_token, 10)
    except ValueError:
        try:
            return int(Decimal(first_token))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError(f"Cannot parse uint: {raw}") from exc


def parse_cast_bool(raw: str) -> bool:
    token = (raw or "").strip().splitlines()[0].strip().lower()
    if token in {"true", "1"}:
        return True
    if token in {"false", "0"}:
        return False
    raise ValueError(f"Unexpected bool value: {raw}")


def parse_cast_address(raw: str) -> str:
    for line in (raw or "").splitlines():
        token = line.strip().split()[0] if line.strip() else ""
        addr = normalize_address(token)
        if addr:
            return addr
    return ""


def decode_hex_text(value: str) -> str:
    token = str(value or "").strip().split()[0]
    if not token.startswith("0x"):
        return token
    if token == "0x":
        return ""
    try:
        return bytes.fromhex(token[2:]).decode("utf-8", errors="ignore").strip("\x00").strip()
    except ValueError:
        return ""


def parse_address_list_from_array(raw: str) -> List[str]:
    return [normalize_address(x) for x in re.findall(r"0x[a-fA-F0-9]{40}", raw or "") if normalize_address(x)]


class CastClient:
    def __init__(self, rpc_url: str, timeout_sec: int = 20):
        parsed = urllib.parse.urlparse(rpc_url)
        if parsed.scheme != "https":
            raise ValueError(f"RPC URL must be https: {rpc_url}")
        if (parsed.hostname or "").lower() not in ALLOWED_RPC_HOSTS:
            raise ValueError(f"RPC host is not allowlisted: {parsed.hostname}")
        self.rpc_url = rpc_url
        self.timeout_sec = timeout_sec
        self._cache: Dict[Tuple[str, str, Tuple[str, ...]], str] = {}
        self._cache_lock = threading.Lock()

    def call(
        self,
        to: str,
        signature: str,
        *args: str,
        allow_fail: bool = False,
        use_cache: bool = True,
    ) -> Optional[str]:
        to_addr = normalize_address(to)
        if not to_addr:
            if allow_fail:
                return None
            raise ValueError(f"Invalid address: {to}")

        key = (to_addr, signature, tuple(str(x) for x in args))
        if use_cache:
            cached = self._cache.get(key)
            if cached is not None:
                return cached

        cmd = ["cast", "call", "--rpc-url", self.rpc_url, to_addr, signature, *map(str, args)]
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=self.timeout_sec,
            check=False,
        )
        if proc.returncode != 0:
            if allow_fail:
                return None
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "cast call failed")

        out = proc.stdout.strip()
        if use_cache:
            self._cache[key] = out
        return out

    def estimate(
        self,
        to: str,
        signature: str,
        from_addr: str,
        value: str,
        *args: str,
    ) -> str:
        to_addr = normalize_address(to)
        if not to_addr:
            raise ValueError(f"Invalid address: {to}")
        from_addr = normalize_address(from_addr)
        if not from_addr:
            raise ValueError(f"Invalid from address: {from_addr}")

        cmd = ["cast", "estimate", "--rpc-url", self.rpc_url, "--from", from_addr]
        if value and value != "0":
            cmd.extend(["--value", value])
        cmd.extend([to_addr, signature])
        cmd.extend(map(str, args))

        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=self.timeout_sec,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "cast estimate failed")
        return proc.stdout.strip()


def ensure_cast() -> None:
    proc = subprocess.run(
        ["cast", "--version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=10,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"cast is not available: {proc.stderr.strip() or proc.stdout.strip()}")


def is_official_eth(addr: str) -> bool:
    return normalize_address(addr) in OFFICIAL_WETH


def is_official_usdc(addr: str) -> bool:
    return normalize_address(addr) in OFFICIAL_USDC


def fetch_token_spot_price_usd(token_address: str) -> Tuple[Optional[float], Optional[str]]:
    token = normalize_address(token_address)
    if not token:
        return None, None

    try:
        payload = http_get_json(DEX_TOKEN_ENDPOINT.format(token=token))
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return None, None
    pairs = payload.get("pairs") or []
    if not isinstance(pairs, list) or not pairs:
        return None, None

    best_dex = None
    best_liq = -1.0
    best = None

    for row in pairs:
        if str(row.get("chainId") or "").lower() != "base":
            continue
        liq = to_float((row.get("liquidity") or {}).get("usd"), default=0.0)
        if liq > best_liq:
            best = row
            best_liq = liq
            best_dex = row.get("dexId") if isinstance(row.get("dexId"), str) else None

    if not best:
        return None, None
    usd = to_float(best.get("priceUsd") or 0.0, default=0.0)
    if usd <= 0:
        return None, None
    return usd, best_dex


def fetch_pair_market(pair_address: str) -> Optional[PairMarket]:
    pair = normalize_address(pair_address)
    if not pair:
        return None

    try:
        payload = http_get_json(DEX_PAIR_ENDPOINT.format(pair=pair))
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return None
    rows = payload.get("pairs") or []
    if not isinstance(rows, list) or not rows:
        return None

    selected = rows[0]
    for row in rows:
        if str(row.get("chainId") or "").lower() == "base" and normalize_address(row.get("pairAddress") or "") == pair:
            selected = row
            break

    txns = (selected.get("txns") or {}).get("h24") or {}
    base = selected.get("baseToken") or {}
    quote = selected.get("quoteToken") or {}
    created_raw = selected.get("pairCreatedAt")
    return PairMarket(
        dex_id=selected.get("dexId") if isinstance(selected.get("dexId"), str) else None,
        pair_url=selected.get("url") if isinstance(selected.get("url"), str) else None,
        liquidity_usd=to_float((selected.get("liquidity") or {}).get("usd"), default=0.0),
        volume_h24_usd=to_float((selected.get("volume") or {}).get("h24"), default=0.0),
        txns_h24=int(to_float(txns.get("buys") or 0.0) + to_float(txns.get("sells") or 0.0)),
        pair_created_at_ms=int(to_float(created_raw, default=0.0)) or None,
        base_token_address=normalize_address(base.get("address") or ""),
        base_token_symbol=(base.get("symbol") or "").strip(),
        base_token_name=(base.get("name") or "").strip(),
        quote_token_address=normalize_address(quote.get("address") or ""),
        quote_token_symbol=(quote.get("symbol") or "").strip(),
        quote_token_name=(quote.get("name") or "").strip(),
    )


def fetch_markets_for_pools(pool_addresses: Sequence[str], workers: int) -> Dict[str, PairMarket]:
    unique = sorted({normalize_address(p) for p in pool_addresses if normalize_address(p)})
    out: Dict[str, PairMarket] = {}
    if not unique:
        return out

    def _worker(addr: str) -> Tuple[str, Optional[PairMarket]]:
        return addr, fetch_pair_market(addr)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futures = [ex.submit(_worker, addr) for addr in unique]
        for fut in as_completed(futures):
            try:
                addr, market = fut.result()
            except Exception:
                continue
            if market:
                out[addr] = market
    return out


def discover_factories(cast: CastClient, registry: str, max_factories: int = 0) -> List[str]:
    out: List[str] = []
    length_raw = cast.call(registry, "poolFactoriesLength()(uint256)", allow_fail=True)
    if length_raw:
        total = parse_cast_uint(length_raw)
        if max_factories > 0:
            total = min(total, max_factories)
        failed_index_lookup = False
        for i in range(total):
            addr = parse_cast_address(cast.call(registry, "poolFactories(uint256)(address)", str(i), allow_fail=True) or "")
            if not addr:
                failed_index_lookup = True
            if is_nonzero_address(addr):
                out.append(addr)
        if out and not failed_index_lookup:
            return out
        if failed_index_lookup and out:
            print("[scan] indexed factory enumeration was incomplete; falling back to full-array factory lookup")

    raw = cast.call(registry, "poolFactories()(address[])", allow_fail=True)
    if not raw:
        return []
    for addr in parse_address_list_from_array(raw):
        if max_factories > 0 and len(out) >= max_factories:
            break
        if is_nonzero_address(addr):
            out.append(addr)
    return out


def discover_pools_for_token_pair(
    cast: CastClient,
    factories: Sequence[str],
    token_a: str,
    token_b: str,
) -> List[str]:
    pair_tokens = [normalize_address(token_a), normalize_address(token_b)]
    if len(pair_tokens) != 2:
        return []
    if pair_tokens[0] == pair_tokens[1]:
        return []

    attempts: List[Tuple[str, str]] = [
        (pair_tokens[0], pair_tokens[1]),
        (pair_tokens[1], pair_tokens[0]),
    ]

    found: List[str] = []
    seen: set[str] = set()
    for factory in factories:
        for token_0, token_1 in attempts:
            # Aerodrome clones normally support (token0, token1, stable) direct lookup.
            for stable in PAIR_LOOKUP_STABLE_OPTIONS:
                raw = cast.call(
                    factory,
                    "getPool(address,address,bool)(address)",
                    token_0,
                    token_1,
                    stable,
                    allow_fail=True,
                )
                if not raw:
                    continue
                pool = parse_cast_address(raw)
                if is_nonzero_address(pool) and pool not in seen:
                    found.append(pool)
                    seen.add(pool)

            # fallback for legacy ABIs that omit stable flag
            if pool_for_token_pair := parse_cast_address(
                cast.call(
                    factory,
                    "getPool(address,address)(address)",
                    token_0,
                    token_1,
                    allow_fail=True,
                ) or ""
            ):
                if is_nonzero_address(pool_for_token_pair) and pool_for_token_pair not in seen:
                    found.append(pool_for_token_pair)
                    seen.add(pool_for_token_pair)
    return found


def discover_pools_for_factory(cast: CastClient, factory: str, max_pools: int = 0) -> List[str]:
    if not factory:
        return []
    raw = cast.call(factory, "allPoolsLength()(uint256)", allow_fail=True)
    if not raw:
        return []
    total = parse_cast_uint(raw)
    if max_pools > 0:
        total = min(total, max_pools)

    out: List[str] = []
    for i in range(total):
        addr = parse_cast_address(cast.call(factory, "allPools(uint256)(address)", str(i), allow_fail=True) or "")
        if is_nonzero_address(addr):
            out.append(addr)
    return out


def discover_pools_from_registry(cast: CastClient, registry: str, max_factories: int, max_pools_per_factory: int) -> List[str]:
    pools: List[str] = []
    for factory in discover_factories(cast, registry, max_factories=max_factories):
        pool_slice = discover_pools_for_factory(cast, factory, max_pools=max_pools_per_factory)
        pools.extend(pool_slice)
    # preserve deterministic order but dedupe while preserving first seen
    return list(dict.fromkeys(pools))


MIN_METADATA_POOL_THRESHOLD = 10


def enumerate_pools(cast: CastClient, args, token_filters: Sequence[str]) -> Tuple[List[str], str]:
    if len(token_filters) == 2 and args.pool_source != "metadata":
        factories = discover_factories(cast, args.factory_registry, max_factories=args.max_factories)
        if factories:
            pair_pools = discover_pools_for_token_pair(cast, factories, token_filters[0], token_filters[1])
            if pair_pools:
                print(f"[scan] found pools via direct pair lookup: {len(pair_pools)}")
                return pair_pools[: args.max_pools] if args.max_pools > 0 else pair_pools, "chain-pair-lookup"
            print(
                "[scan] exact token pair was not found via chain factory pair lookup "
                f"({token_filters[0]}, {token_filters[1]})"
            )
        elif args.pool_source == "chain":
            print("[scan] no factory addresses were discovered from chain; skipping pair lookup fallback")
        return [], "chain-pair-lookup"

    def _prefer_metadata() -> bool:
        if args.pool_source == "chain":
            return False
        if args.pool_source == "metadata":
            return True
        # auto mode defaults to metadata for speed, unless token filters are used.
        return not token_filters

    metadata_path = repo_root() / "metadata" / "live_contracts_base_mainnet.csv"
    if _prefer_metadata() and metadata_path.exists():
        with metadata_path.open("r", encoding="utf-8") as fp:
            rows = list(csv.DictReader(fp))
        pools = []
        for row in rows:
            if (row.get("role") or "").lower() == "pool":
                addr = normalize_address(row.get("address") or "")
                if addr:
                    pools.append(addr)
        if pools and len(pools) >= MIN_METADATA_POOL_THRESHOLD and not token_filters:
            print(f"[scan] pool source: metadata (count={len(pools)})")
            if token_filters:
                print(f"[scan] token filters: {', '.join(token_filters)}")
            return (pools[: args.max_pools] if args.max_pools > 0 else pools), "metadata"
        if pools and token_filters:
            print("[scan] token filter requested; metadata pool list may be incomplete, using chain discovery for full sweep")
        if pools and len(pools) < MIN_METADATA_POOL_THRESHOLD:
            print(f"[scan] metadata only has {len(pools)} pools; attempting chain fallback")

    fallback = discover_pools_from_registry(
        cast,
        args.factory_registry,
        max_factories=args.max_factories,
        max_pools_per_factory=args.max_pools_per_factory,
    )
    if args.max_pools > 0:
        fallback = fallback[: args.max_pools]
    if not fallback:
        raise RuntimeError("No pools discovered from registry")
    print(f"[scan] pool source: chain (count={len(fallback)})")
    if token_filters:
        print(f"[scan] token filters: {', '.join(token_filters)}")
    return fallback, "chain"


def read_token_meta(
    cast: CastClient,
    token_addr: str,
    cache: Dict[str, TokenMeta],
    lock,
    fallback_symbol: str = "",
    fallback_name: str = "",
    fetch_price: bool = True,
) -> TokenMeta:
    addr = normalize_address(token_addr)
    if not addr:
        return TokenMeta(address="", symbol="", name="", decimals=18, price_usd=None, price_source=None)

    with lock:
        cached = cache.get(addr)
        if cached is not None:
            return cached

    symbol = decode_hex_text(cast.call(addr, "symbol()(string)", allow_fail=True) or fallback_symbol or "")
    name = decode_hex_text(cast.call(addr, "name()(string)", allow_fail=True) or fallback_name or "")
    decimals_raw = cast.call(addr, "decimals()(uint8)", allow_fail=True)
    decimals = parse_cast_uint(decimals_raw) if decimals_raw else KNOWN_DECIMALS.get(addr, 18)
    if not 0 <= int(decimals) <= 36:
        decimals = KNOWN_DECIMALS.get(addr, 18)

    price_usd = None
    price_source = None
    if fetch_price:
        price_usd, price_source = fetch_token_spot_price_usd(addr)

    meta = TokenMeta(
        address=addr,
        symbol=(symbol or "UNKNOWN").strip(),
        name=(name or "UNKNOWN").strip(),
        decimals=int(decimals or 18),
        price_usd=price_usd,
        price_source=price_source,
    )

    with lock:
        cache[addr] = meta
    return meta


def read_pool_market_data(cast: CastClient, pool: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "token0": "",
        "token1": "",
        "decimals0": None,
        "decimals1": None,
        "reserve0": None,
        "reserve1": None,
        "stable": None,
        "fee_rate": 0.0,
        "fee_source": "",
        "factory": "",
        "metadata_amp_factor": None,
        "metadata_gamma": None,
    }

    meta_raw = cast.call(
        pool,
        "metadata()(uint256,uint256,uint256,uint256,bool,address,address)",
        allow_fail=True,
    )
    if meta_raw:
        lines = [ln.strip() for ln in meta_raw.splitlines() if ln.strip()]
        if len(lines) >= 7:
            try:
                out["metadata_amp_factor"] = parse_cast_uint(lines[0])
                out["metadata_gamma"] = parse_cast_uint(lines[1])
                out["reserve0"] = parse_cast_uint(lines[2])
                out["reserve1"] = parse_cast_uint(lines[3])
                out["stable"] = parse_cast_bool(lines[4])
                out["token0"] = parse_cast_address(lines[5])
                out["token1"] = parse_cast_address(lines[6])
            except Exception:
                pass

    if not out["token0"]:
        out["token0"] = parse_cast_address(cast.call(pool, "token0()(address)", allow_fail=True) or "")
    if not out["token1"]:
        out["token1"] = parse_cast_address(cast.call(pool, "token1()(address)", allow_fail=True) or "")

    out["factory"] = parse_cast_address(cast.call(pool, "factory()(address)", allow_fail=True) or "")

    stable = bool(out["stable"]) if out["stable"] is not None else False
    if out["factory"]:
        fee_raw = parse_cast_uint(
            cast.call(
                out["factory"],
                "getFee(address,bool)(uint256)",
                pool,
                str(stable).lower(),
                allow_fail=True,
            )
            or "0"
        )
        if fee_raw:
            out["fee_rate"] = fee_raw / 10_000.0
            out["fee_source"] = "factory_getFee"

    # if factory method not available, fallback legacy fee field
    if not out["fee_rate"]:
        fee_raw = cast.call(pool, "fee()(uint256)", allow_fail=True)
        if fee_raw:
            try:
                out["fee_rate"] = parse_cast_uint(fee_raw) / 1_000_000.0
                out["fee_source"] = "pool_fee"
            except Exception:
                pass

    if out["stable"] is None:
        stable_raw = cast.call(pool, "stable()(bool)", allow_fail=True)
        out["stable"] = bool(parse_cast_bool(stable_raw)) if stable_raw else False

    return out


def read_gauge_state(cast: CastClient, voter: str, pool: str) -> Dict[str, Any]:
    out = {
        "is_gauged": False,
        "gauge": "",
        "is_alive": False,
        "reward_rate": 0.0,
        "reward_rate_raw": None,
        "total_supply": None,
        "bribe_contract": "",
        "fees_contract": "",
    }

    gauge = parse_cast_address(cast.call(voter, "gauges(address)(address)", pool, allow_fail=True) or "")
    if not gauge:
        return out

    out["is_gauged"] = True
    out["gauge"] = gauge

    alive_raw = cast.call(voter, "isAlive(address)(bool)", gauge, allow_fail=True)
    if alive_raw:
        try:
            out["is_alive"] = parse_cast_bool(alive_raw)
        except Exception:
            out["is_alive"] = False

    reward_raw = cast.call(gauge, "rewardRate()(uint256)", allow_fail=True) or "0"
    out["reward_rate_raw"] = parse_cast_uint(reward_raw)
    out["reward_rate"] = parse_cast_uint(reward_raw) / 1e18

    supply_raw = cast.call(gauge, "totalSupply()(uint256)", allow_fail=True)
    if supply_raw:
        out["total_supply"] = parse_cast_uint(supply_raw)

    out["bribe_contract"] = parse_cast_address(cast.call(voter, "gaugeToBribe(address)(address)", gauge, allow_fail=True) or "")
    out["fees_contract"] = parse_cast_address(cast.call(voter, "gaugeToFees(address)(address)", gauge, allow_fail=True) or "")
    return out


def read_bribe_epoch_rewards(
    cast: CastClient,
    reward_contract: str,
    epoch_start_ts: int,
    token_cache: Dict[str, TokenMeta],
    token_cache_lock,
    max_tokens: int,
) -> Tuple[float, List[Dict[str, Any]]]:
    reward_addr = normalize_address(reward_contract)
    if not reward_addr:
        return 0.0, []

    length_raw = cast.call(reward_addr, "rewardsListLength()(uint256)", allow_fail=True)
    if not length_raw:
        return 0.0, []

    count = parse_cast_uint(length_raw)
    if max_tokens > 0:
        count = min(count, max_tokens)

    total_usd = 0.0
    rewards: List[Dict[str, Any]] = []
    for idx in range(count):
        token_addr = parse_cast_address(cast.call(reward_addr, "rewards(uint256)(address)", str(idx), allow_fail=True) or "")
        if not token_addr:
            continue
        reward_raw = cast.call(
            reward_addr,
            "tokenRewardsPerEpoch(address,uint256)(uint256)",
            token_addr,
            str(epoch_start_ts),
            allow_fail=True,
        )
        if not reward_raw:
            continue

        raw_amt = parse_cast_uint(reward_raw)
        token_meta = read_token_meta(
            cast,
            token_addr,
            token_cache,
            token_cache_lock,
        )

        amount = raw_amt / (10 ** int(token_meta.decimals))
        usd = amount * (token_meta.price_usd or 0.0)
        total_usd += usd

        rewards.append(
            {
                "token": token_addr,
                "amount": amount,
                "amount_raw": raw_amt,
                "value_usd": usd,
                "price_usd": token_meta.price_usd,
            }
        )

    return total_usd, rewards


def compute_reward_apr_percent(reward_rate_sec: float, reward_token_price: float, liquidity_usd: float) -> float:
    if reward_rate_sec <= 0 or reward_token_price <= 0 or liquidity_usd <= 0:
        return 0.0
    apr = reward_rate_sec * SECONDS_PER_YEAR * reward_token_price * 100.0 / liquidity_usd
    return apr if math.isfinite(apr) else 0.0


def compute_fee_apr_percent(volume_h24_usd: float, fee_rate: float, liquidity_usd: float) -> float:
    if volume_h24_usd <= 0 or fee_rate <= 0 or liquidity_usd <= 0:
        return 0.0
    apr = volume_h24_usd * fee_rate * 365.0 * 100.0 / liquidity_usd
    return apr if math.isfinite(apr) else 0.0


def compute_bribe_apr_percent(bribe_epoch_usd: float, liquidity_usd: float) -> float:
    if bribe_epoch_usd <= 0 or liquidity_usd <= 0:
        return 0.0
    apr = bribe_epoch_usd * 52.0 * 100.0 / liquidity_usd
    return apr if math.isfinite(apr) else 0.0


def score_token(address: str, symbol: str, name: str) -> Tuple[float, List[str]]:
    addr = normalize_address(address)
    sym = (symbol or "").upper().strip()
    nm = (name or "").strip()
    if is_official_eth(addr):
        return 10.0, ["official_weth"]
    if is_official_usdc(addr):
        return 10.0, ["official_usdc"]

    score = 5.0
    reasons: List[str] = []
    if not sym or sym == "UNKNOWN":
        score -= 1.0
        reasons.append("missing_symbol")
    if not addr:
        score -= 2.0
        reasons.append("missing_token_address")
    if len(sym) > 12:
        score -= 0.6
        reasons.append("symbol_too_long")
    if SUSPICIOUS_TOKEN_RE.search(sym) or SUSPICIOUS_TOKEN_RE.search(nm):
        score -= 3.0
        reasons.append("suspicious_metadata")
    return clamp(score, 0.0, 10.0), reasons


def score_pool(
    token0: TokenMeta,
    token1: TokenMeta,
    liquidity_usd: float,
    volume_24h_usd: float,
    pair_created_ms: Optional[int],
    is_gauged: bool,
    gauge_alive: bool,
) -> Dict[str, Any]:
    if (is_official_eth(token0.address) and is_official_usdc(token1.address)) or (
        is_official_eth(token1.address) and is_official_usdc(token0.address)
    ):
        return {
            "score": 10.0,
            "tier": "high",
            "age_days": None,
            "reasons": ["official_eth_usdc_pair_hard_pinned"],
        }

    s0, reasons0 = score_token(token0.address, token0.symbol, token0.name)
    s1, reasons1 = score_token(token1.address, token1.symbol, token1.name)
    score = (min(s0, s1) * 0.65) + (max(s0, s1) * 0.35)
    reasons = [*reasons0, *reasons1]

    if liquidity_usd >= 1_000_000:
        score += 1.5
        reasons.append("deep_liquidity")
    elif liquidity_usd >= 250_000:
        score += 0.75
        reasons.append("healthy_liquidity")
    elif liquidity_usd < 25_000:
        score -= 1.5
        reasons.append("thin_liquidity")
    elif liquidity_usd < 5_000:
        score -= 2.2
        reasons.append("very_thin_liquidity")

    if not is_gauged:
        score -= 1.0
        reasons.append("not_gauged")
    if is_gauged and not gauge_alive:
        score -= 1.5
        reasons.append("gauge_not_alive")

    if liquidity_usd > 0:
        ratio = safe_div(volume_24h_usd, liquidity_usd)
        if ratio < 0.01:
            score -= 0.5
            reasons.append("low_turnover")
        elif ratio > 0.2:
            score += 0.3
            reasons.append("active_turnover")

    age_days = None
    if pair_created_ms and pair_created_ms > 0:
        age_days = (time.time() - pair_created_ms / 1000.0) / 86400.0
        if age_days < 2:
            reasons.append("very_new_pool")
        elif age_days > 180:
            reasons.append("mature_pool")

    score = round(clamp(score, 0.0, 10.0), 2)
    if score >= 8.5:
        tier = "high"
    elif score >= 6.0:
        tier = "medium"
    elif score >= 3.5:
        tier = "speculative"
    else:
        tier = "high-risk"

    return {
        "score": score,
        "tier": tier,
        "age_days": age_days,
        "reasons": sorted(set(reasons)),
    }


def fetch_gas_price_wei(rpc_url: str) -> Optional[int]:
    try:
        proc = subprocess.run(
            ["cast", "rpc", "eth_gasPrice", "--rpc-url", rpc_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode != 0:
            return None
        text = proc.stdout.strip()
        if text.startswith("0x"):
            return int(text, 16)
        return int(text)
    except Exception:
        return None


def estimate_pool_gas(cast: CastClient, gauge: str, from_addr: str) -> List[Dict[str, Any]]:
    if not gauge or from_addr == ZERO_ADDRESS:
        return []

    out: List[Dict[str, Any]] = []
    for label, sig in (("deposit(0)", "deposit(uint256)"), ("withdraw(0)", "withdraw(uint256)")):
        try:
            estimate_raw = cast.estimate(gauge, sig, from_addr, "0", "0")
            gas = int((estimate_raw.splitlines()[0] or "0").strip(), 10)
            out.append({"signature": label, "gas": gas, "error": None})
        except Exception as exc:
            out.append({"signature": label, "gas": None, "error": str(exc)})
    return out


def gas_cost_estimates_usd(estimates: List[Dict[str, Any]], gas_price_wei: Optional[int], eth_price_usd: Optional[float]) -> Dict[str, Any]:
    if gas_price_wei is None or eth_price_usd is None:
        return {}
    out: Dict[str, Any] = {}
    for row in estimates:
        gas = row.get("gas")
        sig = row.get("signature")
        if not isinstance(gas, int):
            out[sig] = None
            continue
        wei = gas * gas_price_wei
        out[sig] = (wei / 1e18) * eth_price_usd
    return out


def sort_rows(rows: List[Dict[str, Any]], sort_by: str) -> List[Dict[str, Any]]:
    if sort_by == "apr":
        key = lambda r: (to_float(r.get("total_apr_pct")), to_float(r.get("safety_score")), to_float(r.get("liquidity_usd")))
    elif sort_by == "liquidity":
        key = lambda r: (to_float(r.get("liquidity_usd")), to_float(r.get("volume_24h_usd")), to_float(r.get("safety_score")))
    elif sort_by == "volume":
        key = lambda r: (to_float(r.get("volume_24h_usd")), to_float(r.get("liquidity_usd")))
    elif sort_by == "votes":
        key = lambda r: (to_float(r.get("vote_share_pct")), to_float(r.get("liquidity_usd")))
    elif sort_by == "safety":
        key = lambda r: (to_float(r.get("safety_score")), to_float(r.get("liquidity_usd")))
    else:
        raise ValueError(f"Unsupported sort_by {sort_by}")
    return sorted(rows, key=key, reverse=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan Aerodrome pools")
    parser.add_argument("--rpc-url", default=DEFAULT_RPC_URL)
    parser.add_argument("--voter", default=DEFAULT_VOTER)
    parser.add_argument("--factory-registry", default=DEFAULT_FACTORY_REGISTRY)
    parser.add_argument("--voting-escrow", default=DEFAULT_VOTING_ESCROW)
    parser.add_argument("--rewards-distributor", default=DEFAULT_REWARDS_DISTRIBUTOR)
    parser.add_argument("--aero-token", default=DEFAULT_AERO_TOKEN)
    parser.add_argument("--router", default=DEFAULT_ROUTER)
    parser.add_argument("--max-pools", type=int, default=0, help="Limit pool count for fast local tests (0=all)")
    parser.add_argument("--max-factories", type=int, default=0)
    parser.add_argument("--max-pools-per-factory", type=int, default=200)
    parser.add_argument(
        "--pool-source",
        choices=["auto", "metadata", "chain"],
        default="auto",
        help="Pool discovery source for scan (auto, metadata, or chain)",
    )
    parser.add_argument(
        "--token-filter",
        action="append",
        default=[],
        help="Filter pools containing this token address (repeatable)",
    )
    parser.add_argument(
        "--match-all-token-filters",
        action="store_true",
        help="Require every --token-filter token to be in the pool",
    )
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--http-workers", type=int, default=6)
    parser.add_argument("--max-reward-tokens", type=int, default=8)
    parser.add_argument("--sort-by", choices=["apr", "liquidity", "volume", "votes", "safety"], default="apr")
    parser.add_argument("--only-gauged", action="store_true")
    parser.add_argument("--only-alive", action="store_true")
    parser.add_argument("--min-liquidity-usd", type=float, default=0.0)
    parser.add_argument("--min-vote-share", type=float, default=0.0)
    parser.add_argument("--skip-market", action="store_true")
    parser.add_argument("--skip-token-prices", action="store_true")
    parser.add_argument("--skip-bribes", action="store_true")
    parser.add_argument("--include-gas-estimates", action="store_true")
    parser.add_argument("--cast-timeout", type=int, default=DEFAULT_TIMEOUT_SEC, help="Per-cast timeout in seconds")
    parser.add_argument("--gas-from", default=ZERO_ADDRESS)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--out-json", default="runs/aerodrome-pool-intel/latest_report.json")
    parser.add_argument("--out-csv", default="runs/aerodrome-pool-intel/latest_report.csv")
    parser.add_argument("--progress-every", type=int, default=10)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ensure_cast()

    cast_timeout = max(1, args.cast_timeout)
    cast = CastClient(args.rpc_url, timeout_sec=cast_timeout)
    voter = normalize_address(args.voter)
    factory_registry = normalize_address(args.factory_registry)
    voting_escrow = normalize_address(args.voting_escrow)
    rewards_distributor = normalize_address(args.rewards_distributor)
    aero_token = normalize_address(args.aero_token)

    if not all((voter, factory_registry, voting_escrow, rewards_distributor, aero_token)):
        raise RuntimeError("One or more required on-chain addresses is invalid")

    token_filters = normalize_token_filters(getattr(args, "token_filter", []) or [])
    if token_filters and args.pool_source == "metadata":
        print("[scan] warning: token filters requested with --pool-source metadata; results may be incomplete if registry changed since manifest capture")

    print(f"[scan] voter={voter}")
    print(f"[scan] registry={factory_registry}")

    pools, resolved_pool_source = enumerate_pools(cast, args, token_filters)
    if not pools and not (token_filters and len(token_filters) == 2 and args.pool_source != "metadata"):
        raise RuntimeError("No pools discovered")
    print(f"[scan] pools_to_scan={len(pools)}")
    print(f"[scan] token filters: {', '.join(token_filters)}" if token_filters else "[scan] no token filters")

    # market lookups
    markets = fetch_markets_for_pools(pools, workers=max(1, args.http_workers)) if not args.skip_market else {}

    # cached token metadata
    token_cache: Dict[str, TokenMeta] = {}
    token_cache_lock = threading.Lock()

    total_weight = parse_cast_uint(cast.call(voter, "totalWeight()(uint256)", allow_fail=True) or "0")
    now_ts = int(time.time())
    epoch_start = now_ts - (now_ts % SECONDS_PER_WEEK)

    gas_price_wei = fetch_gas_price_wei(args.rpc_url)
    eth_price, _ = fetch_token_spot_price_usd(WETH_ADDRESS)

    def build_row(pool: str) -> Dict[str, Any]:
        pool = normalize_address(pool)
        market = markets.get(pool)
        row: Dict[str, Any] = {
            "pool_address": pool,
            "token_filter_inputs": token_filters,
            "token_filter_hits": [],
            "token_filter_match_any": False,
            "token_filter_match_all": False,
        }
        warnings: List[str] = []
        errors: List[str] = []

        try:
            pool_meta = read_pool_market_data(cast, pool)
            token0_addr = normalize_address(pool_meta["token0"])
            token1_addr = normalize_address(pool_meta["token1"])
            token_filter_hits, token_filter_match_any, token_filter_match_all = token_filter_matches(
                token0_addr,
                token1_addr,
                token_filters,
            )

            # fallback metadata from market (for symbol/name when contract does not return)
            f0_symbol = ""
            f0_name = ""
            f1_symbol = ""
            f1_name = ""
            if market:
                if token0_addr and token0_addr == market.base_token_address:
                    f0_symbol, f0_name = market.base_token_symbol or "", market.base_token_name or ""
                    f1_symbol, f1_name = market.quote_token_symbol or "", market.quote_token_name or ""
                elif token0_addr and token0_addr == market.quote_token_address:
                    f0_symbol, f0_name = market.quote_token_symbol or "", market.quote_token_name or ""
                    f1_symbol, f1_name = market.base_token_symbol or "", market.base_token_name or ""

            token0 = read_token_meta(
                cast,
                token0_addr,
                token_cache,
                token_cache_lock,
                fallback_symbol=f0_symbol,
                fallback_name=f0_name,
                fetch_price=not args.skip_token_prices,
            )
            token1 = read_token_meta(
                cast,
                token1_addr,
                token_cache,
                token_cache_lock,
                fallback_symbol=f1_symbol,
                fallback_name=f1_name,
                fetch_price=not args.skip_token_prices,
            )

            row["token0_address"] = token0.address
            row["token1_address"] = token1.address
            row["token0_symbol"] = token0.symbol
            row["token1_symbol"] = token1.symbol
            row["token0_name"] = token0.name
            row["token1_name"] = token1.name
            row["token0_decimals"] = token0.decimals
            row["token1_decimals"] = token1.decimals

            gauge_state = read_gauge_state(cast, voter, pool)
            row["is_gauged"] = bool(gauge_state["is_gauged"])
            row["is_gauge_alive"] = bool(gauge_state["is_alive"])
            row["gauge_address"] = gauge_state["gauge"]
            row["gauge_total_supply"] = gauge_state.get("total_supply")
            row["gauge_bribe_contract"] = gauge_state.get("bribe_contract")
            row["gauge_fees_contract"] = gauge_state.get("fees_contract")

            vote_weight = parse_cast_uint(cast.call(voter, "weights(address)(uint256)", pool, allow_fail=True) or "0")
            row["vote_weight"] = vote_weight
            row["vote_share_pct"] = safe_div(vote_weight, total_weight) * 100.0 if total_weight else 0.0

            liquidity_usd = to_float(market.liquidity_usd if market else 0.0)
            volume_h24_usd = to_float(market.volume_h24_usd if market else 0.0)
            txns_h24 = int(to_float(market.txns_h24 if market else 0.0))

            if liquidity_usd <= 0 and pool_meta["reserve0"] is not None and pool_meta["reserve1"] is not None:
                amount0 = pool_meta["reserve0"] / (10 ** int(pool_meta["decimals0"] or token0.decimals))
                amount1 = pool_meta["reserve1"] / (10 ** int(pool_meta["decimals1"] or token1.decimals))
                inferred = (amount0 * (token0.price_usd or 0.0)) + (amount1 * (token1.price_usd or 0.0))
                if inferred > 0:
                    liquidity_usd = inferred
                    warnings.append("liquidity_inferred_from_reserves")

            fee_rate = to_float(pool_meta["fee_rate"])
            reward_rate = to_float(gauge_state["reward_rate"])

            bribe_epoch_usd = 0.0
            bribe_breakdown: List[Dict[str, Any]] = []
            if not args.skip_bribes:
                for contract_type in ("bribe_contract", "fees_contract"):
                    contract_addr = normalize_address(gauge_state.get(contract_type) or "")
                    if not contract_addr:
                        continue
                    bribe_usd, entries = read_bribe_epoch_rewards(
                        cast,
                        contract_addr,
                        epoch_start,
                        token_cache,
                        token_cache_lock,
                        max_tokens=args.max_reward_tokens,
                    )
                    if bribe_usd > 0:
                        bribe_epoch_usd += bribe_usd
                        for item in entries:
                            item["source"] = contract_type
                            item["reward_contract"] = contract_addr
                        bribe_breakdown.extend(entries)

            reward_price = 0.0
            if token_cache.get(aero_token):
                reward_price = token_cache[aero_token].price_usd or 0.0
            else:
                reward_price = fetch_token_spot_price_usd(aero_token)[0] or 0.0

            reward_apr = compute_reward_apr_percent(reward_rate, reward_price, liquidity_usd)
            fee_apr = compute_fee_apr_percent(volume_h24_usd, fee_rate, liquidity_usd)
            bribe_apr = compute_bribe_apr_percent(bribe_epoch_usd, liquidity_usd)

            safety = score_pool(
                token0=token0,
                token1=token1,
                liquidity_usd=liquidity_usd,
                volume_24h_usd=volume_h24_usd,
                pair_created_ms=market.pair_created_at_ms if market else None,
                is_gauged=bool(gauge_state["is_gauged"]),
                gauge_alive=bool(gauge_state["is_alive"]),
            )

            pair_created_at = None
            if market and market.pair_created_at_ms:
                try:
                    pair_created_at = dt.datetime.fromtimestamp(
                        market.pair_created_at_ms / 1000.0,
                        tz=dt.timezone.utc,
                    ).isoformat()
                except Exception:
                    pair_created_at = None
                # keep row update outside the market guard so skip-market scans still emit a full row

            row.update(
                {
                    "pair_created_at": pair_created_at,
                    "dex_id": market.dex_id if market else None,
                    "pair_url": market.pair_url if market else None,
                    "stable": bool(pool_meta["stable"]),
                    "pool_factory": pool_meta["factory"],
                    "decimals0": token0.decimals,
                    "decimals1": token1.decimals,
                    "reserve0": pool_meta["reserve0"],
                    "reserve1": pool_meta["reserve1"],
                    "metadata_amp_factor": pool_meta.get("metadata_amp_factor"),
                    "metadata_gamma": pool_meta.get("metadata_gamma"),
                    "liquidity_usd": liquidity_usd,
                    "volume_24h_usd": volume_h24_usd,
                    "txns_24h": txns_h24,
                    "fee_rate": fee_rate,
                    "fee_rate_source": pool_meta["fee_source"],
                    "reward_rate_aero_per_sec": reward_rate,
                    "reward_rate_aero_per_day": reward_rate * 86400.0,
                    "bribe_epoch_usd": bribe_epoch_usd,
                    "reward_apr_pct": reward_apr,
                    "fee_apr_pct": fee_apr,
                    "bribe_apr_pct": bribe_apr,
                    "total_apr_pct": reward_apr + fee_apr + bribe_apr,
                    "safety_score": safety["score"],
                    "safety_tier": safety["tier"],
                    "safety_reasons": safety["reasons"],
                    "age_days": safety["age_days"],
                    "bribe_rewards": bribe_breakdown,
                    "warnings": warnings,
                    "token_filter_inputs": token_filters,
                    "token_filter_hits": token_filter_hits,
                    "token_filter_match_any": token_filter_match_any,
                    "token_filter_match_all": token_filter_match_all,
                }
            )

            if args.include_gas_estimates:
                gas_from = normalize_address(args.gas_from)
                if not gas_from:
                    gas_from = ZERO_ADDRESS
                gas_rows = estimate_pool_gas(cast, gauge_state["gauge"], gas_from)
                row["gas_estimates"] = gas_rows
                row["gas_cost_usd"] = gas_cost_estimates_usd(gas_rows, gas_price_wei, eth_price)
            else:
                row["gas_estimates"] = []
                row["gas_cost_usd"] = {}

            if not token0_addr or not token1_addr:
                warnings.append("missing_pool_tokens")

        except Exception as exc:
            errors.append(f"scan_error:{exc}")

        row["errors"] = errors
        if not row.get("warnings"):
            row["warnings"] = warnings

        return row

    rows: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futures = [ex.submit(build_row, p) for p in pools]
        completed = 0
        for fut in as_completed(futures):
            rows.append(fut.result())
            completed += 1
            if completed == len(futures) or completed % max(1, args.progress_every) == 0:
                print(f"[scan] progress: {completed}/{len(futures)}")

    # Filters
    if token_filters:
        if args.match_all_token_filters:
            rows = [r for r in rows if bool(r.get("token_filter_match_all"))]
        else:
            rows = [r for r in rows if bool(r.get("token_filter_match_any"))]
        if not rows:
            print(
                f"[scan] no rows matched token filters={','.join(token_filters)} "
                f"source={resolved_pool_source} scanned_pools={len(pools)}"
            )
    if args.only_gauged:
        rows = [r for r in rows if bool(r.get("is_gauged"))]
    if args.only_alive:
        rows = [r for r in rows if bool(r.get("is_gauge_alive"))]
    if args.min_liquidity_usd > 0:
        rows = [r for r in rows if to_float(r.get("liquidity_usd"), default=0.0) >= args.min_liquidity_usd]
    if args.min_vote_share > 0:
        rows = [r for r in rows if to_float(r.get("vote_share_pct"), default=0.0) >= args.min_vote_share]

    rows = sort_rows(rows, args.sort_by)
    for idx, r in enumerate(rows, start=1):
        r["rank"] = idx

    if args.strict:
        failures: List[str] = []
        if not rows:
            failures.append("No rows after filtering")
        for row in rows:
            if row.get("errors"):
                failures.append(f"Scan error on {row.get('pool_address')}: {row.get('errors')}")
            for field in ("reward_apr_pct", "fee_apr_pct", "bribe_apr_pct", "total_apr_pct", "safety_score"):
                if not math.isfinite(to_float(row.get(field), default=float("nan"))):
                    failures.append(f"Non-finite field {field} on {row.get('pool_address')}")
            is_eth_usdc_pair = (
                (is_official_eth(row.get("token0_address") or "")
                and is_official_usdc(row.get("token1_address") or ""))
                or (is_official_eth(row.get("token1_address") or "")
                    and is_official_usdc(row.get("token0_address") or ""))
            )
            if is_eth_usdc_pair and to_float(row.get("safety_score"), default=0.0) < 10.0:
                failures.append(f"ETH/USDC pair not scored 10.0: {row.get('pool_address')}")
        if failures:
            raise RuntimeError("Strict mode validation failed:\n- " + "\n- ".join(failures[:20]))

    ve_supply_raw = cast.call(voting_escrow, "supply()(uint256)", allow_fail=True) or "0"
    ve_locked_nova = parse_cast_uint(ve_supply_raw) / 1e18

    distributor_raw = cast.call(
        rewards_distributor,
        "tokens_per_week(uint256)(uint256)",
        str(epoch_start),
        allow_fail=True,
    )
    distributor_weekly_nova = parse_cast_uint(distributor_raw or "0") / 1e18
    aero_price_usd, aero_price_source = fetch_token_spot_price_usd(aero_token)

    report = {
        "generated_at_utc": now_iso_utc(),
        "inputs": {
            "rpc_url": args.rpc_url,
            "voter": voter,
            "factory_registry": factory_registry,
            "voting_escrow": voting_escrow,
            "rewards_distributor": rewards_distributor,
            "aero_token": aero_token,
            "pool_source_request": args.pool_source,
            "pool_source_resolved": resolved_pool_source,
            "token_filters": token_filters,
            "token_filter_match_all": bool(args.match_all_token_filters),
            "router": normalize_address(args.router),
            "sort_by": args.sort_by,
            "max_pools": args.max_pools,
            "max_factories": args.max_factories,
            "max_pools_per_factory": args.max_pools_per_factory,
            "skip_market": args.skip_market,
            "skip_bribes": args.skip_bribes,
            "include_gas_estimates": args.include_gas_estimates,
        },
        "protocol_summary": {
            "pool_count_scanned": len(rows),
            "gauged_pool_count": sum(1 for r in rows if r.get("is_gauged")),
            "alive_gauge_count": sum(1 for r in rows if r.get("is_gauge_alive")),
            "total_liquidity_usd": sum(to_float(r.get("liquidity_usd"), default=0.0) for r in rows),
            "total_volume_24h_usd": sum(to_float(r.get("volume_24h_usd"), default=0.0) for r in rows),
            "safety_distribution": {
                "high": sum(1 for r in rows if r.get("safety_tier") == "high"),
                "medium": sum(1 for r in rows if r.get("safety_tier") == "medium"),
                "speculative": sum(1 for r in rows if r.get("safety_tier") == "speculative"),
                "high-risk": sum(1 for r in rows if r.get("safety_tier") == "high-risk"),
            },
            "aero_price_usd": aero_price_usd,
            "aero_price_source": aero_price_source,
            "ve_locked_aero": ve_locked_nova,
            "ve_locked_aero_value_usd": ve_locked_nova * (aero_price_usd or 0.0),
            "rewards_distributor_epoch_aero": distributor_weekly_nova,
            "rewards_distributor_epoch_aero_value_usd": distributor_weekly_nova * (aero_price_usd or 0.0),
        },
        "rows": rows,
    }

    out_json = Path(args.out_json)
    out_csv = Path(args.out_csv)
    if not out_json.is_absolute():
        out_json = repo_root() / out_json
    if not out_csv.is_absolute():
        out_csv = repo_root() / out_csv
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    csv_fields = [
        "rank",
        "pool_address",
        "token0_symbol",
        "token1_symbol",
        "is_gauged",
        "is_gauge_alive",
        "gauge_address",
        "vote_share_pct",
        "liquidity_usd",
        "volume_24h_usd",
        "fee_rate",
        "reward_apr_pct",
        "fee_apr_pct",
        "bribe_apr_pct",
        "total_apr_pct",
        "safety_score",
        "safety_tier",
        "safety_reasons",
        "pair_created_at",
        "pair_url",
        "warnings",
        "errors",
        "gas_estimates",
        "gas_cost_usd",
        "token_filter_inputs",
        "token_filter_hits",
        "token_filter_match_any",
        "token_filter_match_all",
    ]
    with out_csv.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=csv_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    **{k: row.get(k) for k in csv_fields},
                    "warnings": ";".join(row.get("warnings") or []),
                    "errors": ";".join(row.get("errors") or []),
                    "safety_reasons": ";".join(row.get("safety_reasons") or []),
                    "token_filter_inputs": ";".join(row.get("token_filter_inputs") or []),
                    "token_filter_hits": ";".join(row.get("token_filter_hits") or []),
                    "gas_estimates": json.dumps(row.get("gas_estimates") or []),
                    "gas_cost_usd": json.dumps(row.get("gas_cost_usd") or {}),
                }
            )

    # Topline diagnostics
    print(f"[scan] wrote json: {out_json}")
    print(f"[scan] wrote csv : {out_csv}")
    print(f"[scan] pools kept: {len(rows)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        raise SystemExit(1)
