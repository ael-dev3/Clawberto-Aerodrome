#!/usr/bin/env python3
"""Hermes cron script precheck for the Aerodrome LP supervisor.

Reads the deterministic watcher state and emits JSON. Hermes cron can suppress
LLM wakeups when wakeAgent is false; if the scheduler still wakes, the prompt
must respond [SILENT] for wakeAgent=false.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

REPO = Path('/Users/marko/.openclaw/workspace/Clawberto-Aerodrome')
STATE_PATH = REPO / 'runs' / 'aerodrome-lp-supervisor' / 'state.json'
POLICY = {
    'poll_seconds': 15,
    'hermes_supervisor_schedule': 'every 1m',
    'state_max_age_seconds': 20,
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


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def parse_ts_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        if value.endswith('Z'):
            value = value[:-1] + '+00:00'
        from datetime import datetime
        return datetime.fromisoformat(value).timestamp()
    except Exception:
        return None


def main() -> None:
    wakeAgent = False
    output: dict[str, Any] = {
        'wakeAgent': False,
        'actionRequired': False,
        'recommendedAction': 'HOLD',
        'reason': 'state_ok',
        'policy': POLICY,
        'statePath': str(STATE_PATH),
    }

    try:
        state = read_json(STATE_PATH)
    except Exception as exc:
        output.update({
            'wakeAgent': True,
            'actionRequired': False,
            'recommendedAction': 'ALERT_REVIEW_ONLY',
            'reason': 'missing_or_unreadable_watcher_state',
            'error': str(exc),
        })
        print(json.dumps(output, indent=2, sort_keys=True))
        return

    state_at = parse_ts_seconds(state.get('at'))
    age_seconds = None if state_at is None else max(0, time.time() - state_at)
    stale = age_seconds is None or age_seconds > POLICY['state_max_age_seconds']

    if stale:
        wakeAgent = True
        output.update({
            'reason': 'watcher_state_stale',
            'recommendedAction': 'ALERT_REVIEW_ONLY',
            'actionRequired': False,
            'age_seconds': age_seconds,
        })
    elif state.get('wakeAgent') is True:
        wakeAgent = True
        output.update({
            'reason': 'watcher_requested_agent',
            'recommendedAction': state.get('recommendedAction', 'ALERT_REVIEW_ONLY'),
            'actionRequired': bool(state.get('actionRequired')),
            'age_seconds': age_seconds,
        })
    else:
        output.update({
            'age_seconds': age_seconds,
        })

    output['wakeAgent'] = bool(wakeAgent)
    output['state'] = state
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
