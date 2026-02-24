#!/usr/bin/env python3
"""Deterministic Aerodrome contract-call helper for OpenClaw.

Supports two safe read patterns:
- static call via `cast call`
- gas estimation via `cast estimate` for a known function and arguments

The helper keeps strict safety gates:
- HTTPS RPC only
- allowlist by default (core + discovered contracts)
- strict signature format validation
- optional structured JSON output
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Set

ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
SIGNATURE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\([^)]*\)\([^)]*\)$")

DEFAULT_RPC_URL = "https://base-rpc.publicnode.com"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

CORE_ADDRESSES: Dict[str, str] = {
    "voter": "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    "voting_escrow": "0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4",
    "factory_registry": "0x5C3F18F06CC09CA1910767A34a20F771039E37C0",
    "gauge_factory": "0x35f35cA5B132CaDf2916BaB57639128eAC5bbcb5",
    "pool_factory": "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    "aero_token": "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    "router": "0xcF77a3Ba9A5CA399B7c97c74D54e5b1Beb874E43",
    "minter": "0xeB018363F0a9Af8f91F06FEe6613a751b2A33FE5",
    "rewards_distributor": "0x227f65131A261548b057215bB1D5Ab2997964C7d",
    "art_proxy": "0xE9992487b2EE03b7a91241695A58E0ef3654643E",
}

METADATA_PATH = Path("metadata/live_contracts_base_mainnet.csv")


def normalize_address(value: str) -> str:
    text = str(value or "").strip()
    if ADDRESS_RE.match(text):
        return text.lower()
    return ""


def parse_value(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "0"
    if text.lower().startswith("0x"):
        return text
    if re.fullmatch(r"\d+", text):
        return text
    raise ValueError(f"Unsupported value format for --value: {value}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Safe Aerodrome contract helper")
    parser.add_argument("--rpc-url", default=DEFAULT_RPC_URL, help=f"Base RPC URL (default: {DEFAULT_RPC_URL})")
    parser.add_argument("--to", default="", help="Target contract address")
    parser.add_argument("--sig", default="", help="Function signature, e.g. 'length()(uint256)'")
    parser.add_argument("--arg", action="append", default=[], help="Call argument (repeatable)")
    parser.add_argument("--allow-any-address", action="store_true", help="Allow calls outside the known Aerodrome registry")
    parser.add_argument("--list-core", action="store_true", help="Print registered Aerodrome addresses and exit")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    parser.add_argument("--estimate-gas", action="store_true", help="Estimate gas using `cast estimate`")
    parser.add_argument("--from-address", default=ZERO_ADDRESS, help="caller address for gas estimates")
    parser.add_argument("--value", default="0", help="wei value for gas estimate path (decimal or hex)")
    return parser.parse_args()


def ensure_cast() -> None:
    try:
        proc = subprocess.run(
            ["cast", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
            check=False,
        )
    except FileNotFoundError as exc:  # pragma: no cover - environment issue
        raise RuntimeError(
            "cast is not installed. Install Foundry first: "
            "https://book.getfoundry.sh/getting-started/installation"
        ) from exc

    if proc.returncode != 0:
        raise RuntimeError(f"cast is not available: {proc.stderr.strip() or proc.stdout.strip()}")


def validate_rpc(rpc_url: str) -> None:
    parsed = urllib.parse.urlparse(rpc_url)
    if parsed.scheme != "https":
        raise RuntimeError(f"RPC URL must use HTTPS, got: {rpc_url}")


def load_known_addresses(repo_root: Path) -> Set[str]:
    known: Set[str] = set(v.lower() for v in CORE_ADDRESSES.values() if normalize_address(v))

    metadata_csv = repo_root / METADATA_PATH
    if not metadata_csv.exists():
        return known

    with metadata_csv.open("r", encoding="utf-8") as fp:
        reader = csv.DictReader(fp)
        for row in reader:
            if row is None:
                continue
            address = normalize_address(row.get("address", "") or row.get("Address", ""))
            if address:
                known.add(address)

    return known


def run_cast_call(rpc_url: str, to: str, signature: str, args: List[str]) -> str:
    cmd = ["cast", "call", "--rpc-url", rpc_url, to, signature, *args]
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=40,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "unknown cast error")
    return proc.stdout.strip()


def run_cast_estimate(rpc_url: str, to: str, signature: str, args: List[str], from_address: str, value: str) -> str:
    cmd = [
        "cast",
        "estimate",
        "--rpc-url",
        rpc_url,
        "--from",
        from_address,
        to,
        signature,
        *args,
    ]
    if value and value != "0":
        cmd.extend(["--value", value])

    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=40,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "unknown cast estimate error")
    return proc.stdout.strip()


def main() -> int:
    args = parse_args()
    ensure_cast()
    validate_rpc(args.rpc_url)

    repo_root = Path(__file__).resolve().parents[3]
    known_addresses = load_known_addresses(repo_root)

    if args.list_core:
        payload: Dict[str, Any] = {
            "core_addresses": CORE_ADDRESSES,
            "known_contract_count": len(known_addresses),
            "metadata_file": str(METADATA_PATH),
            "metadata_exists": str((repo_root / METADATA_PATH).exists()),
        }
        print(json.dumps(payload, indent=2))
        return 0

    target = normalize_address(args.to)
    if not target:
        raise RuntimeError("--to must be a valid 0x address")

    if not args.allow_any_address and target not in known_addresses:
        raise RuntimeError(
            "Blocked address: not in known Aerodrome contract registry. "
            "Use --allow-any-address only when intentionally calling an ad-hoc contract."
        )

    signature = args.sig.strip()
    if not signature:
        raise RuntimeError("--sig is required unless --list-core is used")
    if not SIGNATURE_RE.match(signature):
        raise RuntimeError(
            "Invalid --sig format. Expected e.g. 'weights(address)(uint256)'. "
            "Return type list cannot be omitted."
        )

    if args.estimate_gas:
        from_addr = normalize_address(args.from_address)
        if not from_addr:
            raise RuntimeError("--from-address must be a valid 0x address")
        value = parse_value(args.value)
        output = run_cast_estimate(
            rpc_url=args.rpc_url,
            to=target,
            signature=signature,
            args=args.arg,
            from_address=from_addr,
            value=value,
        )
    else:
        output = run_cast_call(args.rpc_url, target, signature, args.arg)

    if args.json:
        payload = {
            "rpc_url": args.rpc_url,
            "mode": "estimate" if args.estimate_gas else "call",
            "to": target,
            "signature": signature,
            "arguments": args.arg,
            "value": args.value,
            "from_address": normalize_address(args.from_address),
            "output_raw": output,
            "output_lines": [ln.strip() for ln in output.splitlines() if ln.strip()],
        }
        print(json.dumps(payload, indent=2))
    else:
        print(output)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        raise SystemExit(1)
