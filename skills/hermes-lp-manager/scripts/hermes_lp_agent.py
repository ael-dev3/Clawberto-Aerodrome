#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_CONFIG_PATH = SKILL_DIR / "references" / "lfi-usdc-pool.json"
DEFAULT_RPC_URL = "https://base-rpc.publicnode.com"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
ADDRESS_RE = re.compile(r"0x[a-fA-F0-9]{40}")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
BRACKET_SUFFIX_RE = re.compile(r"\s+\[[^\]]+\]$")

POSITIONS_SIG = (
    "positions(uint256)"
    "(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)"
)
SLOT0_SIG = "slot0()(uint160,int24,uint16,uint16,uint16,bool)"


class HermesError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_address(value: Any) -> str:
    text = str(value or "").strip()
    match = ADDRESS_RE.search(text)
    return match.group(0).lower() if match else text.lower()


def is_address(value: Any) -> bool:
    return bool(ADDRESS_RE.fullmatch(str(value or "").strip()))


def clean_cast_line(line: str) -> str:
    out = ANSI_RE.sub("", line).strip()
    out = BRACKET_SUFFIX_RE.sub("", out).strip()
    return out.strip('"')


def split_cast_output(raw: Optional[str]) -> List[str]:
    if raw is None:
        return []
    text = raw.strip()
    if not text:
        return []
    lines = [clean_cast_line(line) for line in text.splitlines() if clean_cast_line(line)]
    if len(lines) == 1 and "," in lines[0]:
        one = lines[0].strip()
        if one.startswith("(") and one.endswith(")"):
            one = one[1:-1]
        return [clean_cast_line(part) for part in one.split(",") if clean_cast_line(part)]
    return lines


def parse_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    if value is None:
        return default
    text = clean_cast_line(str(value))
    match = re.search(r"-?0x[0-9a-fA-F]+|-?\d+", text)
    if not match:
        return default
    token = match.group(0)
    try:
        if token.startswith("-0x"):
            return -int(token[3:], 16)
        if token.startswith("0x"):
            return int(token, 16)
        return int(token, 10)
    except ValueError:
        return default


def parse_bool(value: Any) -> Optional[bool]:
    text = str(value or "").strip().lower()
    if text in {"true", "1"}:
        return True
    if text in {"false", "0"}:
        return False
    return None


def parse_address(value: Any) -> Optional[str]:
    match = ADDRESS_RE.search(str(value or ""))
    return match.group(0).lower() if match else None


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as fp:
        return json.load(fp)


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, indent=2, sort_keys=True)
        fp.write("\n")
    tmp.replace(path)


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def load_config(path: Path) -> Dict[str, Any]:
    config = load_json(path)
    required = ["pool_address", "gauge_address", "nft_manager_address", "token0", "token1", "tick_spacing"]
    missing = [key for key in required if key not in config]
    if missing:
        raise HermesError(f"config missing required fields: {', '.join(missing)}")
    return config


def env_or_config_number(name: str, config_value: Any, default: float) -> float:
    raw = os.environ.get(name, config_value)
    if raw is None or raw == "":
        return default
    try:
        out = float(raw)
    except (TypeError, ValueError):
        raise HermesError(f"{name} must be numeric, got {raw!r}")
    if not math.isfinite(out):
        raise HermesError(f"{name} must be finite, got {raw!r}")
    return out


def load_thresholds(config: Dict[str, Any]) -> Dict[str, Any]:
    strategy = config.get("strategy") or {}
    return {
        "min_headroom_ticks": int(env_or_config_number("HERMES_MIN_HEADROOM_TICKS", strategy.get("min_headroom_ticks"), 400)),
        "min_headroom_pct": env_or_config_number("HERMES_MIN_HEADROOM_PCT", strategy.get("min_headroom_pct"), 0.15),
        "min_earned_aero_wei": int(env_or_config_number("HERMES_MIN_EARNED_AERO_WEI", strategy.get("min_earned_aero_wei"), 0)),
        "min_tvl_usd": env_or_config_number("HERMES_MIN_TVL_USD", strategy.get("min_tvl_usd"), 10000),
        "default_slippage_bps": int(env_or_config_number("HERMES_DEFAULT_SLIPPAGE_BPS", strategy.get("default_slippage_bps"), 100)),
    }


def format_pct(value: Any) -> str:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return "n/a"
    if not math.isfinite(out):
        return "n/a"
    return f"{out * 100:.2f}%"


def decision_to_required_action(decision: str) -> str:
    return {
        "HOLD": "NONE",
        "CLAIM_REWARD_RECOMMENDED": "CLAIM_REWARD",
        "STAKE_REMEDIATION_REQUIRED": "STAKE_REMEDIATION_REQUIRED",
        "UNSTAKE_REBALANCE_RESTAKE_REQUIRED": "REBALANCE_COMPOUND_RESTAKE",
        "MANUAL_REVIEW": "MANUAL_REVIEW",
    }.get(decision, "MANUAL_REVIEW")


class CastReader:
    def __init__(self, rpc_url: str, timeout_sec: int = 30) -> None:
        self.rpc_url = rpc_url
        self.timeout_sec = timeout_sec
        self.cast_bin = shutil.which("cast")
        if not self.cast_bin:
            raise HermesError("cast is not installed. Install Foundry before running live Hermes reads.")

    def call(self, to: str, signature: str, *args: Any, allow_fail: bool = False) -> Optional[str]:
        cmd = [self.cast_bin or "cast", "call", "--rpc-url", self.rpc_url, to, signature, *map(str, args)]
        proc = subprocess.run(cmd, text=True, capture_output=True, timeout=self.timeout_sec)
        if proc.returncode != 0:
            message = (proc.stderr or proc.stdout or "cast call failed").strip()
            if allow_fail:
                return None
            raise HermesError(f"cast call failed for {to} {signature}: {message}")
        return proc.stdout.strip()


def parse_position(raw: Optional[str]) -> Dict[str, Any]:
    fields = split_cast_output(raw)
    if len(fields) < 12:
        raise HermesError(f"positions() returned {len(fields)} fields, expected 12")
    return {
        "nonce": parse_int(fields[0], 0),
        "operator": parse_address(fields[1]) or canonical_address(fields[1]),
        "token0": parse_address(fields[2]) or canonical_address(fields[2]),
        "token1": parse_address(fields[3]) or canonical_address(fields[3]),
        "tick_spacing": parse_int(fields[4]),
        "tick_lower": parse_int(fields[5]),
        "tick_upper": parse_int(fields[6]),
        "liquidity": parse_int(fields[7], 0),
        "fee_growth_inside0_last_x128": parse_int(fields[8], 0),
        "fee_growth_inside1_last_x128": parse_int(fields[9], 0),
        "tokens_owed0": parse_int(fields[10], 0),
        "tokens_owed1": parse_int(fields[11], 0),
    }


def parse_slot0(raw: Optional[str]) -> Dict[str, Any]:
    fields = split_cast_output(raw)
    if len(fields) < 2:
        raise HermesError(f"slot0() returned {len(fields)} fields, expected at least 2")
    return {
        "sqrt_price_x96": parse_int(fields[0]),
        "tick": parse_int(fields[1]),
        "unlocked": parse_bool(fields[-1]),
    }


def read_live_snapshot(config: Dict[str, Any], token_id: int, depositor: str, rpc_url: str, timeout_sec: int) -> Dict[str, Any]:
    reader = CastReader(rpc_url, timeout_sec=timeout_sec)
    errors: List[str] = []

    def safe(label: str, to: str, sig: str, *args: Any, allow_fail: bool = False) -> Optional[str]:
        try:
            return reader.call(to, sig, *args, allow_fail=allow_fail)
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            return None

    pool = canonical_address(config["pool_address"])
    gauge = canonical_address(config["gauge_address"])
    nft = canonical_address(config["nft_manager_address"])
    depositor_addr = canonical_address(depositor) if depositor else ""

    slot0: Dict[str, Any] = {}
    position: Dict[str, Any] = {"token_id": token_id}
    gauge_state: Dict[str, Any] = {"address": gauge}

    raw_slot0 = safe("pool.slot0", pool, SLOT0_SIG)
    if raw_slot0 is not None:
        try:
            slot0 = parse_slot0(raw_slot0)
        except Exception as exc:
            errors.append(f"pool.slot0 parse: {exc}")

    raw_owner = safe("nft.ownerOf", nft, "ownerOf(uint256)(address)", token_id)
    if raw_owner is not None:
        position["owner"] = parse_address(raw_owner) or canonical_address(raw_owner)

    raw_position = safe("nft.positions", nft, POSITIONS_SIG, token_id)
    if raw_position is not None:
        try:
            position.update(parse_position(raw_position))
        except Exception as exc:
            errors.append(f"nft.positions parse: {exc}")

    raw_reward_rate = safe("gauge.rewardRate", gauge, "rewardRate()(uint256)", allow_fail=True)
    raw_left = safe("gauge.left", gauge, "left()(uint256)", allow_fail=True)
    gauge_state["reward_rate_wei_per_sec"] = parse_int(raw_reward_rate, 0)
    gauge_state["left_wei"] = parse_int(raw_left, 0)

    if depositor_addr:
        raw_staked = safe("gauge.stakedContains", gauge, "stakedContains(address,uint256)(bool)", depositor_addr, token_id, allow_fail=True)
        raw_earned = safe("gauge.earned", gauge, "earned(address,uint256)(uint256)", depositor_addr, token_id, allow_fail=True)
        raw_deposit_ts = safe("gauge.depositTimestamp", gauge, "depositTimestamp(uint256)(uint256)", token_id, allow_fail=True)
        gauge_state["staked_contains"] = parse_bool(raw_staked)
        gauge_state["earned_wei"] = parse_int(raw_earned, 0)
        gauge_state["deposit_timestamp"] = parse_int(raw_deposit_ts, 0)
    else:
        gauge_state["staked_contains"] = None
        gauge_state["earned_wei"] = None
        gauge_state["deposit_timestamp"] = None

    return {
        "generated_at_utc": utc_now(),
        "source": "live-cast",
        "chain_id": config.get("chain_id"),
        "pool": {
            "address": pool,
            "tick": slot0.get("tick"),
            "sqrt_price_x96": slot0.get("sqrt_price_x96"),
            "unlocked": slot0.get("unlocked"),
        },
        "position": position,
        "gauge": gauge_state,
        "depositor": depositor_addr,
        "errors": errors,
    }


def add_gate(gates: List[Dict[str, Any]], name: str, status: str, detail: str) -> None:
    gates.append({"name": name, "status": status, "detail": detail})


def build_tx_plan(decision: str, config: Dict[str, Any], snapshot: Dict[str, Any], blockers: List[str]) -> List[Dict[str, Any]]:
    token_id = int((snapshot.get("position") or {}).get("token_id") or (config.get("managed_position") or {}).get("token_id") or 0)
    depositor = canonical_address(snapshot.get("depositor") or "")
    gauge = canonical_address(config["gauge_address"])
    nft = canonical_address(config["nft_manager_address"])
    blocked = bool(blockers) or not depositor

    def item(phase: str, target: str, signature: str, args: List[Any], note: str, status: Optional[str] = None) -> Dict[str, Any]:
        return {
            "phase": phase,
            "target": target,
            "signature": signature,
            "args": [str(arg) for arg in args],
            "sender": depositor or "REQUIRED_DEPOSITOR",
            "status": status or ("blocked" if blocked else "needs_simulation"),
            "note": note,
        }

    if decision == "CLAIM_REWARD_RECOMMENDED":
        return [
            item("claim", gauge, "getReward(uint256)", [token_id], "Claim AERO rewards from the depositor while leaving the NFT staked.")
        ]
    if decision == "STAKE_REMEDIATION_REQUIRED":
        return [
            item("approve-nft", nft, "approve(address,uint256)", [gauge, token_id], "Approve the CL gauge for this NFT if approval is not already present."),
            item("stake", gauge, "deposit(uint256)", [token_id], "Stake the NFT into the configured gauge, then verify gauge custody."),
        ]
    if decision == "UNSTAKE_REBALANCE_RESTAKE_REQUIRED":
        return [
            item("unstake", gauge, "withdraw(uint256)", [token_id], "Withdraw staked NFT to the depositor before touching principal."),
            item("collect-before-decrease", nft, "collect((uint256,address,uint128,uint128))", [token_id, depositor or "RECIPIENT", "MAX_UINT128", "MAX_UINT128"], "Collect fees after unstake; tuple values must be encoded by the signer adapter.", "needs_parameters" if not blocked else "blocked"),
            item("decrease-liquidity", nft, "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))", [token_id, "LIQUIDITY", "AMOUNT0_MIN", "AMOUNT1_MIN", "DEADLINE"], "Decrease old liquidity with fresh amount minimums.", "needs_parameters" if not blocked else "blocked"),
            item("collect-after-decrease", nft, "collect((uint256,address,uint128,uint128))", [token_id, depositor or "RECIPIENT", "MAX_UINT128", "MAX_UINT128"], "Collect principal and any remaining fees.", "needs_parameters" if not blocked else "blocked"),
            item("mint-replacement", nft, "mint((address,address,int24,int24,int24,uint256,uint256,uint256,uint256,address,uint256,uint160))", ["TOKEN0", "TOKEN1", config["tick_spacing"], "TICK_LOWER", "TICK_UPPER", "AMOUNT0_DESIRED", "AMOUNT1_DESIRED", "AMOUNT0_MIN", "AMOUNT1_MIN", depositor or "RECIPIENT", "DEADLINE", 0], "Mint a replacement CL NFT with ticks aligned to the configured spacing.", "needs_parameters" if not blocked else "blocked"),
            item("stake-new", gauge, "deposit(uint256)", ["NEW_TOKEN_ID"], "Stake the replacement NFT after mint verification.", "needs_parameters" if not blocked else "blocked"),
        ]
    return []


def evaluate(config: Dict[str, Any], snapshot: Dict[str, Any], thresholds: Dict[str, Any], mode: str) -> Dict[str, Any]:
    gates: List[Dict[str, Any]] = []
    blockers: List[str] = []
    recommendations: List[str] = []

    errors = list(snapshot.get("errors") or [])
    for error in errors:
        blockers.append(error)
    if errors:
        add_gate(gates, "required_reads", "FAIL", f"{len(errors)} read or parse errors")
    else:
        add_gate(gates, "required_reads", "PASS", "live status inputs loaded")

    position = snapshot.get("position") or {}
    pool = snapshot.get("pool") or {}
    gauge_state = snapshot.get("gauge") or {}
    token_id = position.get("token_id") or (config.get("managed_position") or {}).get("token_id")

    config_token0 = canonical_address((config.get("token0") or {}).get("address"))
    config_token1 = canonical_address((config.get("token1") or {}).get("address"))
    position_token0 = canonical_address(position.get("token0"))
    position_token1 = canonical_address(position.get("token1"))
    tick_spacing = parse_int(position.get("tick_spacing"))
    expected_spacing = int(config["tick_spacing"])

    if position_token0 == config_token0 and position_token1 == config_token1 and tick_spacing == expected_spacing:
        add_gate(gates, "position_identity", "PASS", "token order and tick spacing match config")
    else:
        add_gate(gates, "position_identity", "FAIL", "position token order or tick spacing does not match config")
        blockers.append("position identity mismatch")

    owner = canonical_address(position.get("owner"))
    gauge = canonical_address(config["gauge_address"])
    depositor = canonical_address(snapshot.get("depositor") or "")
    staked_contains = gauge_state.get("staked_contains")

    custody_state = "unknown"
    if owner == gauge:
        custody_state = "staked"
        add_gate(gates, "gauge_custody", "PASS", "NFT owner is the configured gauge")
        if depositor:
            if staked_contains is True:
                add_gate(gates, "depositor_stake_membership", "PASS", "depositor is recorded in gauge stake set")
            else:
                add_gate(gates, "depositor_stake_membership", "FAIL", "gauge custody exists but depositor stake membership is not confirmed")
                blockers.append("depositor stake membership not confirmed")
        else:
            add_gate(gates, "depositor_known", "WARN", "depositor is required before claiming, unstaking, or restaking")
    elif depositor and owner == depositor:
        custody_state = "unstaked-to-depositor"
        add_gate(gates, "gauge_custody", "WARN", "NFT is held by depositor, not staked in gauge")
    elif owner:
        add_gate(gates, "gauge_custody", "FAIL", f"NFT owner {owner} is neither gauge nor depositor")
        blockers.append("unexpected NFT owner")
    else:
        add_gate(gates, "gauge_custody", "FAIL", "NFT owner is unavailable")
        blockers.append("NFT owner unavailable")

    current_tick = parse_int(pool.get("tick"))
    tick_lower = parse_int(position.get("tick_lower"))
    tick_upper = parse_int(position.get("tick_upper"))
    range_state = {
        "current_tick": current_tick,
        "tick_lower": tick_lower,
        "tick_upper": tick_upper,
        "lower_headroom_ticks": None,
        "upper_headroom_ticks": None,
        "lower_headroom_pct": None,
        "upper_headroom_pct": None,
        "min_headroom_ticks": None,
        "min_headroom_pct": None,
        "configured_half_width_ticks": None,
        "in_range": None,
        "near_edge": None,
    }

    out_of_range = False
    near_edge = False
    if current_tick is None or tick_lower is None or tick_upper is None or tick_upper <= tick_lower:
        add_gate(gates, "range_health", "FAIL", "range inputs are incomplete or invalid")
        blockers.append("range inputs unavailable")
    else:
        lower_headroom = current_tick - tick_lower
        upper_headroom = tick_upper - current_tick
        width = tick_upper - tick_lower
        min_headroom = min(lower_headroom, upper_headroom)
        min_headroom_pct = min_headroom / width if width > 0 else 0.0
        out_of_range = current_tick < tick_lower or current_tick > tick_upper
        near_edge = (not out_of_range) and (
            min_headroom < thresholds["min_headroom_ticks"] or min_headroom_pct < thresholds["min_headroom_pct"]
        )
        range_state.update(
            {
                "lower_headroom_ticks": lower_headroom,
                "upper_headroom_ticks": upper_headroom,
                "lower_headroom_pct": lower_headroom / width if width > 0 else None,
                "upper_headroom_pct": upper_headroom / width if width > 0 else None,
                "min_headroom_ticks": min_headroom,
                "min_headroom_pct": min_headroom_pct,
                "configured_half_width_ticks": width // 2,
                "in_range": not out_of_range,
                "near_edge": near_edge,
            }
        )
        if out_of_range:
            add_gate(gates, "range_health", "FAIL", "current tick is outside the NFT range")
        elif near_edge:
            add_gate(gates, "range_health", "WARN", "current tick is inside range but too close to an edge")
        else:
            add_gate(gates, "range_health", "PASS", "current tick has sufficient configured headroom")

    ui_info = config.get("ui_pool_info") or {}
    tvl_usd = float(ui_info.get("tvl_usd") or 0)
    if tvl_usd and tvl_usd < thresholds["min_tvl_usd"]:
        add_gate(gates, "market_liquidity", "WARN", f"configured TVL ${tvl_usd:.2f} is below threshold")
    elif tvl_usd:
        add_gate(gates, "market_liquidity", "PASS", f"configured TVL ${tvl_usd:.2f} meets threshold")
    else:
        add_gate(gates, "market_liquidity", "WARN", "no market TVL snapshot configured")

    earned_wei = parse_int(gauge_state.get("earned_wei"))
    reward_ready = earned_wei is not None and earned_wei >= thresholds["min_earned_aero_wei"] and thresholds["min_earned_aero_wei"] > 0

    decision = "HOLD"
    severity = "info"
    if blockers:
        decision = "MANUAL_REVIEW"
        severity = "critical"
    elif custody_state == "unstaked-to-depositor":
        decision = "STAKE_REMEDIATION_REQUIRED"
        severity = "warning"
        recommendations.append("Approve the gauge and stake the NFT after simulation.")
    elif out_of_range or near_edge:
        if depositor:
            decision = "UNSTAKE_REBALANCE_RESTAKE_REQUIRED"
            severity = "critical" if out_of_range else "warning"
            recommendations.append("Regenerate withdraw, collect, decrease, mint, and restake plan from fresh reads.")
        else:
            decision = "MANUAL_REVIEW"
            severity = "critical"
            blockers.append("depositor required for rebalance plan")
    elif reward_ready:
        if depositor:
            decision = "CLAIM_REWARD_RECOMMENDED"
            severity = "notice"
            recommendations.append("Claim AERO reward if gas and min-stake penalty policy allow it.")
        else:
            decision = "MANUAL_REVIEW"
            severity = "critical"
            blockers.append("depositor required for reward claim")

    if mode == "execute":
        add_gate(gates, "execution_adapter", "FAIL", "execute mode requested but no signer adapter is implemented")
        blockers.append("execution adapter not implemented")
        decision = "MANUAL_REVIEW"
        severity = "critical"

    required_action = decision_to_required_action(decision)
    tx_plan = build_tx_plan(decision, config, snapshot, blockers)

    return {
        "generated_at_utc": utc_now(),
        "mode": mode,
        "skill": "hermes-lp-manager",
        "pool_config": {
            "name": config.get("name"),
            "pool_address": canonical_address(config["pool_address"]),
            "gauge_address": canonical_address(config["gauge_address"]),
            "nft_manager_address": canonical_address(config["nft_manager_address"]),
            "token0_symbol": (config.get("token0") or {}).get("symbol"),
            "token1_symbol": (config.get("token1") or {}).get("symbol"),
            "tick_spacing": expected_spacing,
            "ui_pool_info": ui_info,
        },
        "token_id": token_id,
        "decision": decision,
        "required_heartbeat_action": required_action,
        "severity": severity,
        "blockers": blockers,
        "recommendations": recommendations,
        "gates": gates,
        "range_state": range_state,
        "snapshot": snapshot,
        "thresholds": thresholds,
        "tx_plan": tx_plan,
    }


def render_summary(plan: Dict[str, Any]) -> str:
    cfg = plan.get("pool_config") or {}
    range_state = plan.get("range_state") or {}
    snapshot = plan.get("snapshot") or {}
    gauge_state = snapshot.get("gauge") or {}
    ui_info = cfg.get("ui_pool_info") or {}
    blockers = plan.get("blockers") or []
    tx_plan = plan.get("tx_plan") or []
    lines = [
        "Hermes LP heartbeat",
        f"- generated_at_utc: {plan.get('generated_at_utc')}",
        f"- mode: {plan.get('mode')}",
        f"- pool: {cfg.get('token0_symbol')}/{cfg.get('token1_symbol')} {cfg.get('pool_address')}",
        f"- gauge: {cfg.get('gauge_address')}",
        f"- token_id: {plan.get('token_id')}",
        f"- decision: {plan.get('decision')} severity={plan.get('severity')}",
        f"- required heartbeat action: {plan.get('required_heartbeat_action')}",
        (
            "- range: "
            f"tick={range_state.get('current_tick')} "
            f"lower={range_state.get('tick_lower')} "
            f"upper={range_state.get('tick_upper')} "
            f"min_headroom={range_state.get('min_headroom_ticks')}"
        ),
        (
            "- range each side: "
            f"lower={format_pct(range_state.get('lower_headroom_pct'))} | "
            f"upper={format_pct(range_state.get('upper_headroom_pct'))}"
        ),
        (
            "- ticks each side now: "
            f"lower={range_state.get('lower_headroom_ticks')} | "
            f"upper={range_state.get('upper_headroom_ticks')}"
        ),
        f"- configured ticks each side: half_width={range_state.get('configured_half_width_ticks')}",
        f"- stake integrity: {stake_integrity(plan)}",
        f"- pending reward now: {gauge_state.get('earned_wei')} wei AERO",
        f"- est apr: {ui_info.get('apr_pct', 'n/a')}%",
        f"- blockers: {len(blockers)}",
        f"- tx_plan_items: {len(tx_plan)}",
    ]
    for blocker in blockers[:5]:
        lines.append(f"  - blocker: {blocker}")
    return "\n".join(lines) + "\n"


def stake_integrity(plan: Dict[str, Any]) -> str:
    gates = {str(gate.get("name")): str(gate.get("status")) for gate in plan.get("gates") or []}
    if gates.get("gauge_custody") == "PASS" and gates.get("depositor_stake_membership", "PASS") == "PASS":
        return "PASS"
    if gates.get("gauge_custody") == "WARN":
        return "WARN"
    return "FAIL"


def render_contract(plan: Dict[str, Any]) -> str:
    cfg = plan.get("pool_config") or {}
    range_state = plan.get("range_state") or {}
    snapshot = plan.get("snapshot") or {}
    gauge_state = snapshot.get("gauge") or {}
    ui_info = cfg.get("ui_pool_info") or {}
    lines = [
        "mode:contract",
        f"generated_at_utc:{plan.get('generated_at_utc')}",
        f"decision:{plan.get('decision')}",
        f"severity:{plan.get('severity')}",
        f"required heartbeat action:{plan.get('required_heartbeat_action')}",
        f"pool:{cfg.get('pool_address')}",
        f"gauge:{cfg.get('gauge_address')}",
        f"tokenId:{plan.get('token_id')}",
        f"range current/lower/upper:{range_state.get('current_tick')}/{range_state.get('tick_lower')}/{range_state.get('tick_upper')}",
        f"range each side:lower={format_pct(range_state.get('lower_headroom_pct'))}|upper={format_pct(range_state.get('upper_headroom_pct'))}",
        f"ticks each side now:lower={range_state.get('lower_headroom_ticks')}|upper={range_state.get('upper_headroom_ticks')}",
        f"configured ticks each side:half_width={range_state.get('configured_half_width_ticks')}",
        f"min headroom:{range_state.get('min_headroom_ticks')} ticks|{format_pct(range_state.get('min_headroom_pct'))}",
        f"stake integrity:{stake_integrity(plan)}",
        f"pending reward now:{gauge_state.get('earned_wei')} wei AERO",
        f"reward rate:{gauge_state.get('reward_rate_wei_per_sec')} wei_per_sec",
        f"lp principal mark:{ui_info.get('tvl_usd')} USD pool_tvl",
        f"est apr:{ui_info.get('apr_pct')}%",
        f"blocker count:{len(plan.get('blockers') or [])}",
        f"tx plan count:{len(plan.get('tx_plan') or [])}",
        f"post-action tokenId/status:{plan.get('token_id')}/{plan.get('decision')}",
    ]
    return "\n".join(lines) + "\n"


def render_highlight(plan: Dict[str, Any]) -> str:
    cfg = plan.get("pool_config") or {}
    range_state = plan.get("range_state") or {}
    snapshot = plan.get("snapshot") or {}
    gauge_state = snapshot.get("gauge") or {}
    ui_info = cfg.get("ui_pool_info") or {}
    lines = [
        f"Heartbeat update ({plan.get('token_id')}): {plan.get('decision')}.",
        "Highlights:",
        f"- Required heartbeat action: {plan.get('required_heartbeat_action')}",
        f"- Range each side: lower={format_pct(range_state.get('lower_headroom_pct'))} | upper={format_pct(range_state.get('upper_headroom_pct'))}",
        f"- Min headroom: {range_state.get('min_headroom_ticks')} ticks ({format_pct(range_state.get('min_headroom_pct'))})",
        f"- Pending reward now: {gauge_state.get('earned_wei')} wei AERO",
        f"- Est APR: {ui_info.get('apr_pct')}%",
        "",
        "Key status:",
        f"- Pool: {cfg.get('token0_symbol')}/{cfg.get('token1_symbol')} {cfg.get('pool_address')}",
        f"- Ticks each side now: lower={range_state.get('lower_headroom_ticks')} | upper={range_state.get('upper_headroom_ticks')}",
        f"- Configured ticks each side: half_width={range_state.get('configured_half_width_ticks')}",
        f"- Stake status: {stake_integrity(plan)}",
        "",
        f"Outcome: {plan.get('severity')} with {len(plan.get('blockers') or [])} blocker(s).",
    ]
    return "\n".join(lines) + "\n"


def render_output(plan: Dict[str, Any], mode: str) -> str:
    if mode == "raw":
        return json.dumps(plan, indent=2, sort_keys=True) + "\n"
    if mode == "contract":
        return render_contract(plan)
    if mode == "highlight":
        return render_highlight(plan)
    return render_summary(plan)


def emit_plan(plan: Dict[str, Any], args: argparse.Namespace) -> None:
    if args.out_json:
        write_json_atomic(Path(args.out_json), plan)
    if args.out_summary:
        write_text_atomic(Path(args.out_summary), render_summary(plan))
    print(render_output(plan, args.output_mode), end="")


def build_contracts_payload(config: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "chain": config.get("chain"),
        "chain_id": config.get("chain_id"),
        "pool": canonical_address(config["pool_address"]),
        "gauge": canonical_address(config["gauge_address"]),
        "nft_manager": canonical_address(config["nft_manager_address"]),
        "swap_router": canonical_address(config.get("swap_router_address")),
        "quoter": canonical_address(config.get("quoter_address")),
        "token0": {
            "symbol": (config.get("token0") or {}).get("symbol"),
            "address": canonical_address((config.get("token0") or {}).get("address")),
            "decimals": (config.get("token0") or {}).get("decimals"),
        },
        "token1": {
            "symbol": (config.get("token1") or {}).get("symbol"),
            "address": canonical_address((config.get("token1") or {}).get("address")),
            "decimals": (config.get("token1") or {}).get("decimals"),
        },
        "tick_spacing": config.get("tick_spacing"),
        "managed_token_id": (config.get("managed_position") or {}).get("token_id"),
    }


def render_contracts(payload: Dict[str, Any]) -> str:
    return "\n".join(
        [
            "Hermes contracts",
            f"- chain_id: {payload.get('chain_id')}",
            f"- pool: {payload.get('pool')}",
            f"- gauge: {payload.get('gauge')}",
            f"- nft_manager: {payload.get('nft_manager')}",
            f"- swap_router: {payload.get('swap_router')}",
            f"- quoter: {payload.get('quoter')}",
            f"- token0: {(payload.get('token0') or {}).get('symbol')} {(payload.get('token0') or {}).get('address')}",
            f"- token1: {(payload.get('token1') or {}).get('symbol')} {(payload.get('token1') or {}).get('address')}",
            f"- tick_spacing: {payload.get('tick_spacing')}",
            f"- managed_token_id: {payload.get('managed_token_id')}",
        ]
    ) + "\n"


def command_contracts(args: argparse.Namespace) -> Dict[str, Any]:
    config = load_config(Path(args.config))
    payload = build_contracts_payload(config)
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(render_contracts(payload), end="")
    return payload


def command_health(args: argparse.Namespace) -> Dict[str, Any]:
    config_path = Path(args.config)
    config = load_config(config_path)
    files = {
        "config": config_path.exists(),
        "output_contract": (SKILL_DIR / "references" / "output-contract.md").exists(),
        "tx_intent_schema": (SKILL_DIR / "references" / "tx-intent-schema.json").exists(),
        "fixture_matrix": (SCRIPT_DIR / "hermes_fixture_matrix.py").exists(),
    }
    payload = {
        "ok": all(files.values()),
        "generated_at_utc": utc_now(),
        "cast_available": shutil.which("cast") is not None,
        "config_name": config.get("name"),
        "files": files,
    }
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        status = "PASS" if payload["ok"] else "FAIL"
        print("Hermes health")
        print(f"- status: {status}")
        print(f"- cast_available: {payload['cast_available']}")
        for name, exists in files.items():
            print(f"- file {name}: {'PASS' if exists else 'FAIL'}")
    return payload


def resolve_token_id(args: argparse.Namespace, config: Dict[str, Any]) -> int:
    raw = args.token_id or os.environ.get("HERMES_TOKEN_ID") or (config.get("managed_position") or {}).get("token_id")
    try:
        token_id = int(raw)
    except (TypeError, ValueError):
        raise HermesError(f"token id must be an integer, got {raw!r}")
    if token_id <= 0:
        raise HermesError("token id must be positive")
    return token_id


def resolve_depositor(args: argparse.Namespace) -> str:
    raw = args.depositor if args.depositor is not None else os.environ.get("HERMES_DEPOSITOR_ADDRESS", "")
    raw = raw.strip()
    if raw and not is_address(raw):
        raise HermesError(f"depositor must be a full 20-byte address, got {raw!r}")
    return canonical_address(raw) if raw else ""


def command_snapshot(args: argparse.Namespace) -> Dict[str, Any]:
    config = load_config(Path(args.config))
    token_id = resolve_token_id(args, config)
    depositor = resolve_depositor(args)
    rpc_url = args.rpc_url or os.environ.get("HERMES_RPC_URL") or config.get("rpc_url") or DEFAULT_RPC_URL
    snapshot = read_live_snapshot(config, token_id, depositor, rpc_url, args.timeout_sec)
    if args.out_json:
        write_json_atomic(Path(args.out_json), snapshot)
    print(json.dumps(snapshot, indent=2, sort_keys=True))
    return snapshot


def command_plan(args: argparse.Namespace) -> Dict[str, Any]:
    config = load_config(Path(args.config))
    snapshot = load_json(Path(args.snapshot))
    thresholds = load_thresholds(config)
    plan = evaluate(config, snapshot, thresholds, args.mode)
    emit_plan(plan, args)
    return plan


def command_heartbeat(args: argparse.Namespace) -> Dict[str, Any]:
    config = load_config(Path(args.config))
    if args.from_snapshot:
        snapshot = load_json(Path(args.from_snapshot))
    else:
        token_id = resolve_token_id(args, config)
        depositor = resolve_depositor(args)
        rpc_url = args.rpc_url or os.environ.get("HERMES_RPC_URL") or config.get("rpc_url") or DEFAULT_RPC_URL
        snapshot = read_live_snapshot(config, token_id, depositor, rpc_url, args.timeout_sec)
    thresholds = load_thresholds(config)
    plan = evaluate(config, snapshot, thresholds, args.mode)
    emit_plan(plan, args)
    return plan


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Pool config JSON path")
    parser.add_argument("--mode", choices=["observe", "propose", "execute"], default=os.environ.get("HERMES_MODE", "propose"))
    parser.add_argument("--output-mode", choices=["summary", "contract", "highlight", "raw"], default=os.environ.get("HERMES_OUTPUT_MODE", "summary"))
    parser.add_argument("--json", action="store_const", const="raw", dest="output_mode", help="Alias for --output-mode raw")
    parser.add_argument("--out-json", default="")
    parser.add_argument("--out-summary", default="")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Hermes Aerodrome CL LP control loop")
    sub = parser.add_subparsers(dest="command", required=True)

    health = sub.add_parser("health", help="Check local Hermes readiness without live RPC reads")
    health.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Pool config JSON path")
    health.add_argument("--json", action="store_true")
    health.set_defaults(func=command_health)

    contracts = sub.add_parser("contracts", help="Print configured Hermes contracts")
    contracts.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Pool config JSON path")
    contracts.add_argument("--json", action="store_true")
    contracts.set_defaults(func=command_contracts)

    snapshot = sub.add_parser("snapshot", help="Read live pool/gauge/NFT state")
    snapshot.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Pool config JSON path")
    snapshot.add_argument("--token-id", default="")
    snapshot.add_argument("--depositor", default=None)
    snapshot.add_argument("--rpc-url", default="")
    snapshot.add_argument("--timeout-sec", type=int, default=30)
    snapshot.add_argument("--out-json", default="")
    snapshot.set_defaults(func=command_snapshot)

    plan = sub.add_parser("plan", help="Build a Hermes decision from a saved snapshot")
    add_common(plan)
    plan.add_argument("--snapshot", required=True)
    plan.set_defaults(func=command_plan)

    heartbeat = sub.add_parser("heartbeat", help="Run snapshot and planning in one cron-safe command")
    add_common(heartbeat)
    heartbeat.add_argument("--token-id", default="")
    heartbeat.add_argument("--depositor", default=None)
    heartbeat.add_argument("--rpc-url", default="")
    heartbeat.add_argument("--timeout-sec", type=int, default=30)
    heartbeat.add_argument("--from-snapshot", default="")
    heartbeat.set_defaults(func=command_heartbeat)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except HermesError as exc:
        print(f"[hermes] {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
