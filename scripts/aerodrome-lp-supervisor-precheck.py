#!/usr/bin/env python3
"""Hermes cron script precheck for the Aerodrome LP supervisor.

Reads the deterministic watcher LP observation plus separate watcher heartbeat
and emits JSON. Hermes cron can suppress LLM wakeups when wakeAgent is false;
if the scheduler still wakes, the prompt must respond [SILENT] for
wakeAgent=false.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import time
from pathlib import Path
from typing import Any

REPO = Path('/Users/marko/.openclaw/workspace/Clawberto-Aerodrome')
RUN_DIR = Path(os.environ.get('HERMES_LP_SUPERVISOR_RUN_DIR', REPO / 'runs' / 'aerodrome-lp-supervisor'))
STATE_PATH = Path(os.environ.get('HERMES_AERODROME_STATE_PATH', os.environ.get('HERMES_LP_SUPERVISOR_STATE_PATH', RUN_DIR / 'state.json')))
HEARTBEAT_PATH = Path(os.environ.get('HERMES_AERODROME_HEARTBEAT_PATH', os.environ.get('HERMES_LP_SUPERVISOR_HEARTBEAT_PATH', RUN_DIR / 'watcher-heartbeat.json')))
HEALTH_PATH = Path(os.environ.get('HERMES_AERODROME_PRECHECK_HEALTH_PATH', os.environ.get('HERMES_LP_SUPERVISOR_PRECHECK_HEALTH_PATH', RUN_DIR / 'precheck-health.json')))

POLICY = {
    'poll_seconds': 15,
    'hermes_supervisor_schedule': 'every 1m',
    'action_state_max_age_seconds': 20,
    'alert_state_max_age_seconds': 60,
    'stale_hysteresis_runs': 2,
    'min_rebalance_cooldown_seconds': 600,
    'max_actions_per_run': 1,
    'edge_trigger': {
        'mode': 'range_aware',
        'trigger_at_percent_of_half_width': 0.20,
        'hard_exit_at_percent_of_half_width': 0.05,
    },
    'execution_guards': {
        'gas_reserve_usd': 1.5,
        'idle_redeploy_threshold_usd': 2.0,
        'min_fee_to_cost_ratio': 3.0,
        'max_slippage_bps': 30,
        'require_quote_freshness_seconds': 10,
    },
}

STALE_ACTION_REASONS = {
    'missing_status_fields',
    'status_stale',
    'out_of_range',
    'desired_range_mismatch',
    'hard_edge_threshold',
    'near_edge_threshold',
    'idle_capital_exceeds_threshold',
    'watcher_error',
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def read_json_optional(path: Path) -> dict[str, Any] | None:
    try:
        return read_json(path)
    except Exception:
        return None


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{os.getpid()}.tmp')
    tmp.write_text(f'{json.dumps(value, indent=2, sort_keys=True)}\n')
    tmp.replace(path)


def parse_ts_seconds(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        if value.endswith('Z'):
            value = value[:-1] + '+00:00'
        return datetime.fromisoformat(value).timestamp()
    except Exception:
        return None


def now_seconds() -> float:
    fixed_epoch = os.environ.get('HERMES_LP_SUPERVISOR_NOW_EPOCH')
    if fixed_epoch:
        try:
            return float(fixed_epoch)
        except ValueError:
            pass
    fixed_iso = os.environ.get('HERMES_AERODROME_PRECHECK_NOW') or os.environ.get('HERMES_LP_SUPERVISOR_NOW_ISO')
    parsed = parse_ts_seconds(fixed_iso)
    if parsed is not None:
        return parsed
    return time.time()


def iso_from_seconds(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace('+00:00', 'Z')


def age_seconds(state: dict[str, Any], now_ts: float) -> float | None:
    state_at = parse_ts_seconds(state.get('at'))
    if state_at is None:
        return None
    return max(0.0, now_ts - state_at)


def has_required_lp_fields(state: dict[str, Any]) -> bool:
    range_state = state.get('range')
    if not isinstance(range_state, dict):
        return False
    required = ['tokenId', 'currentTick', 'lowerTick', 'upperTick', 'inRange']
    return all(range_state.get(key) is not None for key in required)


def is_soft_stale_benign(state: dict[str, Any]) -> bool:
    range_state = state.get('range') if isinstance(state.get('range'), dict) else {}
    reasons = state.get('reasons') if isinstance(state.get('reasons'), list) else []
    percent = range_state.get('percentOfHalfWidth')
    has_edge_evidence = isinstance(percent, (int, float))
    near_edge = has_edge_evidence and percent <= POLICY['edge_trigger']['trigger_at_percent_of_half_width']
    return bool(
        state.get('status') == 'WATCHED'
        and state.get('wakeAgent') is not True
        and state.get('actionRequired') is not True
        and state.get('recommendedAction', 'HOLD') == 'HOLD'
        and range_state.get('inRange') is True
        and range_state.get('desiredMismatch') is not True
        and has_edge_evidence
        and not near_edge
        and not any(reason in STALE_ACTION_REASONS for reason in reasons)
    )


def state_last_success_at(state: dict[str, Any]) -> str | None:
    for key in ('last_success_at', 'watcher_finished_at', 'at'):
        value = state.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def update_health(*, previous: dict[str, Any] | None, state: dict[str, Any] | None, heartbeat: dict[str, Any] | None, stale_for_action: bool, age: float | None, reason: str, now_ts: float) -> dict[str, Any]:
    previous = previous or {}
    if stale_for_action:
        consecutive = int(previous.get('consecutive_stale_runs') or 0) + 1
    else:
        consecutive = 0

    last_fresh_state_at = previous.get('last_fresh_state_at')
    if state:
        observed_at = state_last_success_at(state)
        if observed_at:
            last_fresh_state_at = observed_at

    health = {
        'consecutive_stale_runs': consecutive,
        'last_fresh_state_at': last_fresh_state_at,
        'last_precheck_at': iso_from_seconds(now_ts),
        'last_age_seconds': age,
        'last_reason': reason,
        'state_path': str(STATE_PATH),
        'heartbeat_path': str(HEARTBEAT_PATH),
    }
    if heartbeat:
        health['last_watcher_heartbeat_status'] = heartbeat.get('status')
        health['last_watcher_heartbeat_at'] = heartbeat.get('at')
    write_json_atomic(HEALTH_PATH, health)
    return health


def review_only(reason: str, age: float | None = None) -> dict[str, Any]:
    return {
        'wakeAgent': True,
        'actionRequired': False,
        'canExecute': False,
        'maxExecutableActions': 0,
        'recommendedAction': 'ALERT_REVIEW_ONLY',
        'mode': 'ALERT_REVIEW_ONLY',
        'reason': reason,
        'age_seconds': age,
    }


def main() -> None:
    wakeAgent = False
    now_ts = now_seconds()
    heartbeat = read_json_optional(HEARTBEAT_PATH)
    previous_health = read_json_optional(HEALTH_PATH)
    output: dict[str, Any] = {
        'wakeAgent': False,
        'actionRequired': False,
        'canExecute': False,
        'maxExecutableActions': 0,
        'recommendedAction': 'HOLD',
        'mode': 'SILENT',
        'reason': 'state_ok',
        'policy': POLICY,
        'statePath': str(STATE_PATH),
        'heartbeatPath': str(HEARTBEAT_PATH),
        'healthPath': str(HEALTH_PATH),
    }

    try:
        state = read_json(STATE_PATH)
    except Exception as exc:
        reason = 'missing_or_unreadable_watcher_state'
        health = update_health(previous=previous_health, state=None, heartbeat=heartbeat, stale_for_action=True, age=None, reason=reason, now_ts=now_ts)
        output.update(review_only(reason))
        output.update({'error': str(exc), 'precheckHealth': health})
        if heartbeat is not None:
            output['watcherHeartbeat'] = heartbeat
        print(json.dumps(output, indent=2, sort_keys=True))
        return

    age = age_seconds(state, now_ts)
    stale_for_action = age is None or age >= POLICY['action_state_max_age_seconds']
    stale_for_alert = age is None or age > POLICY['alert_state_max_age_seconds']
    consecutive_if_stale = (int((previous_health or {}).get('consecutive_stale_runs') or 0) + 1) if stale_for_action else 0
    missing_fields = not has_required_lp_fields(state)
    heartbeat_error = bool(heartbeat and heartbeat.get('status') == 'ERROR')

    if heartbeat_error:
        output.update(review_only('watcher_error', age))
    elif missing_fields:
        output.update(review_only('missing_status_fields', age))
    elif stale_for_alert:
        output.update(review_only('watcher_state_stale', age))
    elif stale_for_action:
        if is_soft_stale_benign(state):
            output.update({
                'wakeAgent': False,
                'actionRequired': False,
                'canExecute': False,
                'maxExecutableActions': 0,
                'recommendedAction': 'HOLD',
                'mode': 'SILENT',
                'reason': 'watcher_state_soft_stale',
                'age_seconds': age,
            })
        elif consecutive_if_stale >= POLICY['stale_hysteresis_runs']:
            output.update(review_only('watcher_state_repeated_stale', age))
        else:
            output.update(review_only('watcher_state_stale_action_suppressed', age))
    elif state.get('wakeAgent') is True:
        action_required = bool(state.get('actionRequired'))
        can_execute = action_required and not stale_for_action
        wakeAgent = True
        output.update({
            'wakeAgent': True,
            'actionRequired': action_required,
            'canExecute': can_execute,
            'maxExecutableActions': POLICY['max_actions_per_run'] if can_execute else 0,
            'recommendedAction': state.get('recommendedAction', 'ALERT_REVIEW_ONLY'),
            'mode': 'STRICT_REVIEW' if can_execute else 'ALERT_REVIEW_ONLY',
            'reason': 'watcher_requested_agent',
            'age_seconds': age,
        })
    else:
        output.update({'age_seconds': age})

    reason = str(output['reason'])
    health = update_health(previous=previous_health, state=state, heartbeat=heartbeat, stale_for_action=stale_for_action, age=age, reason=reason, now_ts=now_ts)

    output['wakeAgent'] = bool(output.get('wakeAgent') or wakeAgent)
    output['state'] = state
    output['precheckHealth'] = health
    if heartbeat is not None:
        output['watcherHeartbeat'] = heartbeat
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
