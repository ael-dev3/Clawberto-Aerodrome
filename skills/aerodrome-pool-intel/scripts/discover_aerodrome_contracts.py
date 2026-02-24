#!/usr/bin/env python3
"""Discover live Aerodrome contracts on Base and persist a manifest.

The script intentionally stays read-only and does not require ABIs. It navigates known
protocol entrypoints and writes both JSON and CSV snapshots for downstream scripts.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
from decimal import Decimal, InvalidOperation
import subprocess
import sys
import urllib.parse
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

DEFAULT_RPC_URL = "https://base-rpc.publicnode.com"

KNOWN_CORE_ADDRESSES: Dict[str, str] = {
    "voter": "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    "voting_escrow": "0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4",
    "factory_registry": "0x5C3F18F06CC09CA1910767A34a20F771039E37C0",
    "gauge_factory": "0x35f35cA5B132CaDf2916BaB57639128eAC5bbcb5",
    "rewards_distributor": "0x227f65131A261548b057215bB1D5Ab2997964C7d",
    "minter": "0xeB018363F0a9Af8f91F06FEe6613a751b2A33FE5",
    "router": "0xcF77a3Ba9A5CA399B7c97c74D54e5b1Beb874E43",
    "aero_token": "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    "weth": "0x4200000000000000000000000000000000000006",
    "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
}

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
ADDRESS_RE = __import__("re").compile(r"^0x[a-fA-F0-9]{40}$")


@dataclass
class ContractRow:
    address: str
    chain: str
    role: str
    source: str
    notes: str
    parent: str = ""
    symbol: str = ""


class CastClient:
    def __init__(self, rpc_url: str):
        parsed = urllib.parse.urlparse(rpc_url)
        if parsed.scheme != "https":
            raise ValueError("RPC URL must use HTTPS for safety")
        self.rpc_url = rpc_url

    def call(self, to: str, signature: str, arg: Optional[str] = None, allow_fail: bool = True) -> str:
        addr = to.lower()
        if not ADDRESS_RE.match(addr):
            if allow_fail:
                return ""
            raise ValueError(f"Invalid address: {to}")

        cmd = ["cast", "call", "--rpc-url", self.rpc_url, addr, signature]
        if arg is not None:
            cmd.append(str(arg))

        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20,
            check=False,
        )
        if proc.returncode != 0:
            if allow_fail:
                return ""
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "cast call failed")
        return proc.stdout.strip()

    def code_exists(self, address: str) -> bool:
        normalized = address.lower()
        if not ADDRESS_RE.match(normalized):
            return False
        cmd = ["cast", "code", "--rpc-url", self.rpc_url, normalized]
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20,
            check=False,
        )
        if proc.returncode != 0:
            return False
        output = proc.stdout.strip()
        return output not in {"", "0x"}


def parse_uint(raw: str) -> int:
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


def parse_address(raw: str) -> str:
    for line in raw.splitlines():
        token = line.strip().split()[0] if line.strip() else ""
        if token.startswith("0x"):
            token = token.lower()
            if len(token) == 42:
                return token
    return ""

def parse_address_list(raw: str) -> List[str]:
    text = (raw or "").strip()
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        payload = text[1:-1].strip()
        if not payload:
            return []
        out = []
        for addr in payload.replace(",", " ").split():
            addr = addr.strip()
            if ADDRESS_RE.match(addr):
                out.append(addr.lower())
        return out
    return [addr for addr in [parse_address(line) for line in text.splitlines()] if addr]


def ensure_output_dirs() -> None:
    root = Path(__file__).resolve().parents[3]
    (root / "metadata").mkdir(parents=True, exist_ok=True)
    (root / "runs").mkdir(parents=True, exist_ok=True)


def normalize_addr(value: str) -> str:
    value = (value or "").strip().lower()
    return value if ADDRESS_RE.match(value) else ""


def discover_factories(cast: CastClient, registry: str, max_factories: int) -> List[str]:
    factories: List[str] = []
    length_raw = cast.call(registry, "poolFactoriesLength()(uint256)", allow_fail=True)
    if length_raw:
        factory_len = parse_uint(length_raw)
        for i in range(min(factory_len, max_factories) if max_factories > 0 else factory_len):
            raw = cast.call(registry, "poolFactories(uint256)(address)", str(i), allow_fail=True)
            addr = parse_address(raw)
            if addr:
                factories.append(addr)
        if factories:
            return factories

    # fallback: some deployments expose the full array in one call
    raw = cast.call(registry, "poolFactories()(address[])", allow_fail=True)
    if raw:
        factories.extend(parse_address_list(raw))
        return factories[: max_factories] if max_factories > 0 else factories

    return []


def discover_pools_for_factory(cast: CastClient, factory: str, max_pools: int) -> List[str]:
    if not cast.code_exists(factory):
        return []

    length_raw = cast.call(factory, "allPoolsLength()(uint256)", allow_fail=True)
    if not length_raw:
        return []

    count = parse_uint(length_raw)
    if max_pools > 0:
        count = min(count, max_pools)

    pools: List[str] = []
    for idx in range(count):
        raw = cast.call(factory, "allPools(uint256)(address)", str(idx), allow_fail=True)
        addr = parse_address(raw)
        if addr:
            pools.append(addr)
    return pools


def discover_gauges_for_pool(cast: CastClient, voter: str, pool: str) -> str:
    return parse_address(cast.call(voter, "gauges(address)(address)", pool, allow_fail=True))


def discover_token_list_for_pool(cast: CastClient, pool: str) -> Tuple[str, str]:
    token0 = parse_address(cast.call(pool, "token0()(address)", allow_fail=True))
    token1 = parse_address(cast.call(pool, "token1()(address)", allow_fail=True))
    if token0 and token1:
        return token0, token1

    meta_raw = cast.call(pool, "metadata()(uint256,uint256,uint256,uint256,bool,address,address)", allow_fail=True)
    if not meta_raw:
        return "", ""
    lines = [ln.strip() for ln in meta_raw.splitlines() if ln.strip()]
    if len(lines) >= 7:
        t0 = parse_address(lines[5])
        t1 = parse_address(lines[6])
        return t0, t1
    return "", ""


def discover_bribe_and_fee_rewards(cast: CastClient, voter: str, gauge: str) -> Tuple[str, str]:
    if not gauge:
        return "", ""
    bribe = parse_address(cast.call(voter, "gaugeToBribe(address)(address)", gauge, allow_fail=True))
    fees = parse_address(cast.call(voter, "gaugeToFees(address)(address)", gauge, allow_fail=True))
    return bribe, fees


def discover_reward_tokens(cast: CastClient, reward: str, cap: int) -> List[str]:
    out: List[str] = []
    if not reward:
        return out

    length_raw = cast.call(reward, "rewardsListLength()(uint256)", allow_fail=True)
    if not length_raw:
        return out

    length = parse_uint(length_raw)
    if cap > 0:
        length = min(length, cap)

    for i in range(length):
        raw = cast.call(reward, "rewards(uint256)(address)", str(i), allow_fail=True)
        token = parse_address(raw)
        if token and token not in out:
            out.append(token)
    return out


def write_csv(records: List[ContractRow], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.writer(fp)
        writer.writerow(["address", "chain", "role", "source", "parent", "symbol", "notes"])
        for row in sorted(records, key=lambda r: (r.role, r.address)):
            writer.writerow([row.address, row.chain, row.role, row.source, row.parent, row.symbol, row.notes])


def write_json(records: List[ContractRow], path: Path, out: Dict[str, Any]) -> None:
    role_map: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in records:
        role_map[row.role].append(
            {
                "address": row.address,
                "chain": row.chain,
                "source": row.source,
                "parent": row.parent,
                "symbol": row.symbol,
                "notes": row.notes,
            }
        )

    payload = {
        **out,
        "roles": {
            role: sorted(items, key=lambda item: item["address"])
            for role, items in sorted(role_map.items())
        },
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Discover all live Aerodrome contracts on Base")
    parser.add_argument("--rpc-url", default=DEFAULT_RPC_URL)
    parser.add_argument("--factory-registry", default=KNOWN_CORE_ADDRESSES["factory_registry"])
    parser.add_argument("--voter", default=KNOWN_CORE_ADDRESSES["voter"])
    parser.add_argument("--max-factories", type=int, default=0, help="Limit factory scan count (0=all)")
    parser.add_argument("--max-pools-per-factory", type=int, default=0, help="Limit pools per factory (0=all)")
    parser.add_argument("--max-reward-tokens", type=int, default=8, help="Cap reward tokens discovered per reward contract")
    parser.add_argument("--write-json", default="metadata/live_contracts_base_mainnet.json")
    parser.add_argument("--write-csv", default="metadata/live_contracts_base_mainnet.csv")
    parser.add_argument("--preview", type=int, default=25, help="preview first N rows in stdout")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parents[3]
    cast = CastClient(args.rpc_url)
    ensure_output_dirs()

    for name, addr in KNOWN_CORE_ADDRESSES.items():
        if not cast.code_exists(addr):
            raise RuntimeError(f"Core contract is not live: {name}={addr}")

    records: List[ContractRow] = []
    errors: List[str] = []
    known: Set[str] = set()

    def add(addr: str, role: str, source: str, parent: str = "", notes: str = "") -> None:
        addr = normalize_addr(addr)
        if not addr or addr == ZERO_ADDRESS:
            return
        if addr in known:
            return
        known.add(addr)
        records.append(ContractRow(addr, chain="8453", role=role, source=source, parent=parent, notes=notes))

    for name, addr in KNOWN_CORE_ADDRESSES.items():
        add(addr, "core", "seed", parent="", notes=f"known_{name}")

    try:
        factory_registry = normalize_addr(args.factory_registry)
        voter = normalize_addr(args.voter)
        if not factory_registry or not voter:
            raise RuntimeError("Invalid --factory-registry or --voter")

        factories = discover_factories(cast, factory_registry, max_factories=args.max_factories)
        for idx, factory in enumerate(factories):
            add(factory, "pool_factory", "factory_registry", parent=factory_registry, notes=f"index={idx}")
            pools = discover_pools_for_factory(cast, factory, args.max_pools_per_factory)
            for p_idx, pool in enumerate(pools):
                add(pool, "pool", "pool_factory", parent=factory, notes=f"index={p_idx}")

                t0, t1 = discover_token_list_for_pool(cast, pool)
                for token in (t0, t1):
                    if token:
                        add(token, "token", "pool_metadata", parent=pool, notes="pool token")

                gauge = discover_gauges_for_pool(cast, voter, pool)
                if gauge:
                    add(gauge, "gauge", "voter", parent=pool, notes="live gauge")

                bribe, fees = discover_bribe_and_fee_rewards(cast, voter, gauge)
                for label, reward_contract in ("bribe", bribe), ("fees", fees):
                    if reward_contract:
                        add(
                            reward_contract,
                            "reward_contract",
                            f"voter_{label}",
                            parent=gauge,
                            notes="IReward-compatible",
                        )
                        for r_token in discover_reward_tokens(cast, reward_contract, args.max_reward_tokens):
                            add(
                                r_token,
                                "reward_token",
                                f"{label}_reward_contract",
                                parent=reward_contract,
                                notes="reward distribution token",
                            )
    except Exception as exc:
        errors.append(str(exc))

    output_json = Path(args.write_json)
    output_csv = Path(args.write_csv)
    if not output_json.is_absolute():
        output_json = root / output_json
    if not output_csv.is_absolute():
        output_csv = root / output_csv
    summary: Dict[str, Any] = {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "chain": "Base",
        "chain_id": 8453,
        "rpc_url": args.rpc_url,
        "inputs": {
            "factory_registry": normalize_addr(args.factory_registry),
            "voter": normalize_addr(args.voter),
            "max_factories": args.max_factories,
            "max_pools_per_factory": args.max_pools_per_factory,
            "max_reward_tokens": args.max_reward_tokens,
        },
        "counts": {
            "total": len(records),
            "core": sum(1 for r in records if r.role == "core"),
            "pool_factory": sum(1 for r in records if r.role == "pool_factory"),
            "pool": sum(1 for r in records if r.role == "pool"),
            "gauge": sum(1 for r in records if r.role == "gauge"),
            "token": sum(1 for r in records if r.role == "token"),
            "reward_contract": sum(1 for r in records if r.role == "reward_contract"),
            "reward_token": sum(1 for r in records if r.role == "reward_token"),
        },
        "errors": errors,
    }

    write_csv(records, output_csv)
    write_json(records, output_json, summary)

    print(f"discovery complete: total={len(records)}")
    print(f"json: {output_json}")
    print(f"csv: {output_csv}")

    preview = sorted(records, key=lambda r: (r.role, r.address))
    for row in preview[: args.preview]:
        print(f"- {row.role:18} {row.address} parent={row.parent or '-'} source={row.source} notes={row.notes}")

    if errors:
        print("[warn] discovery errors:")
        for issue in errors:
            print(f"- {issue}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        raise SystemExit(1)
