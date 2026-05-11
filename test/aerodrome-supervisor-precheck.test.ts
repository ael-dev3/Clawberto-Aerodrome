// @ts-nocheck
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO = process.cwd();
const SCRIPT = path.join(REPO, 'scripts/aerodrome-lp-supervisor-precheck.py');
const NOW_EPOCH = 1_778_493_600; // 2026-05-11T12:00:00Z
const NOW_ISO = new Date(NOW_EPOCH * 1000).toISOString().replace('.000Z', 'Z');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function secondsAgo(seconds: number): string {
  return new Date((NOW_EPOCH - seconds) * 1000).toISOString().replace('.000Z', 'Z');
}

function tempRunDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aero-precheck-'));
  tempDirs.push(dir);
  return dir;
}

function holdInRangeState(ageSeconds: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'WATCHED',
    at: secondsAgo(ageSeconds),
    watcher_started_at: secondsAgo(ageSeconds + 9),
    watcher_finished_at: secondsAgo(ageSeconds),
    status_runtime_ms: 9_000,
    last_success_at: secondsAgo(ageSeconds),
    consecutive_errors: 0,
    status_command_timeout_ms: 45_000,
    wakeAgent: false,
    actionRequired: false,
    recommendedAction: 'HOLD',
    reasons: [],
    range: {
      tokenId: 357764,
      currentTick: -364945,
      lowerTick: -365000,
      upperTick: -364800,
      inRange: true,
      desiredMismatch: false,
      percentOfHalfWidth: 0.55,
    },
    ...overrides,
  };
}

function runPrecheck({
  state,
  heartbeat,
  runDir = tempRunDir(),
}: {
  state: Record<string, unknown>;
  heartbeat?: Record<string, unknown>;
  runDir?: string;
}) {
  const statePath = path.join(runDir, 'state.json');
  const heartbeatPath = path.join(runDir, 'watcher-heartbeat.json');
  const healthPath = path.join(runDir, 'precheck-health.json');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  if (heartbeat) writeFileSync(heartbeatPath, `${JSON.stringify(heartbeat, null, 2)}\n`);
  const stdout = execFileSync('python3', [SCRIPT], {
    cwd: REPO,
    env: {
      ...process.env,
      HERMES_AERODROME_STATE_PATH: statePath,
      HERMES_AERODROME_HEARTBEAT_PATH: heartbeatPath,
      HERMES_AERODROME_PRECHECK_HEALTH_PATH: healthPath,
      HERMES_AERODROME_PRECHECK_NOW: NOW_ISO,
    },
    encoding: 'utf8',
  });
  return {
    output: JSON.parse(stdout),
    healthPath,
    health: JSON.parse(readFileSync(healthPath, 'utf8')),
    runDir,
  };
}

describe('Aerodrome LP supervisor precheck stale-state behavior', () => {
  it('keeps HOLD/in-range soft stale state silent at 34 seconds', () => {
    const { output, health } = runPrecheck({ state: holdInRangeState(34) });

    expect(output.wakeAgent).toBe(false);
    expect(output.actionRequired).toBe(false);
    expect(output.recommendedAction).toBe('HOLD');
    expect(output.reason).toBe('watcher_state_soft_stale');
    expect(output.age_seconds).toBe(34);
    expect(output.policy.action_state_max_age_seconds).toBe(20);
    expect(output.policy.alert_state_max_age_seconds).toBe(60);
    expect(health.consecutive_stale_runs).toBe(1);
    expect(health.last_fresh_state_at).toBe(secondsAgo(34));
    expect(health.last_reason).toBe('watcher_state_soft_stale');
  });

  it('wakes review-only on HOLD/in-range hard stale state at 61 seconds', () => {
    const { output, health } = runPrecheck({ state: holdInRangeState(61) });

    expect(output.wakeAgent).toBe(true);
    expect(output.actionRequired).toBe(false);
    expect(output.recommendedAction).toBe('ALERT_REVIEW_ONLY');
    expect(output.reason).toBe('watcher_state_stale');
    expect(output.age_seconds).toBe(61);
    expect(health.consecutive_stale_runs).toBe(1);
  });

  it('wakes review-only when stale state was actionable', () => {
    const { output } = runPrecheck({
      state: holdInRangeState(34, {
        wakeAgent: true,
        actionRequired: true,
        recommendedAction: 'STRICT_CLI_REBALANCE_REVIEW',
        reasons: ['near_edge_threshold'],
      }),
    });

    expect(output.wakeAgent).toBe(true);
    expect(output.actionRequired).toBe(false);
    expect(output.recommendedAction).toBe('ALERT_REVIEW_ONLY');
    expect(output.reason).toMatch(/stale/);
  });

  it('never permits execution from stale state', () => {
    const { output } = runPrecheck({
      state: holdInRangeState(25, {
        wakeAgent: true,
        actionRequired: true,
        recommendedAction: 'STRICT_CLI_REBALANCE_REVIEW',
      }),
    });

    expect(output.age_seconds).toBe(25);
    expect(output.wakeAgent).toBe(true);
    expect(output.actionRequired).toBe(false);
    expect(output.recommendedAction).toBe('ALERT_REVIEW_ONLY');
    expect(output.recommendedAction).not.toBe('STRICT_CLI_REBALANCE_REVIEW');
  });

  it('keeps repeated benign HOLD/in-range soft-stale samples silent before the alert threshold', () => {
    const runDir = tempRunDir();
    const first = runPrecheck({ runDir, state: holdInRangeState(34) });
    const second = runPrecheck({ runDir, state: holdInRangeState(34) });

    expect(first.output.wakeAgent).toBe(false);
    expect(first.health.consecutive_stale_runs).toBe(1);
    expect(second.output.wakeAgent).toBe(false);
    expect(second.output.actionRequired).toBe(false);
    expect(second.output.recommendedAction).toBe('HOLD');
    expect(second.output.reason).toBe('watcher_state_soft_stale');
    expect(second.health.consecutive_stale_runs).toBe(2);
  });

  it('does not silence soft-stale HOLD/in-range state without edge-distance evidence', () => {
    const { output } = runPrecheck({
      state: holdInRangeState(34, {
        range: {
          tokenId: 357764,
          currentTick: -364945,
          lowerTick: -365000,
          upperTick: -364800,
          inRange: true,
          desiredMismatch: false,
        },
      }),
    });

    expect(output.wakeAgent).toBe(true);
    expect(output.actionRequired).toBe(false);
    expect(output.recommendedAction).toBe('ALERT_REVIEW_ONLY');
    expect(output.reason).toBe('watcher_state_stale_action_suppressed');
  });

  it('wakes immediately when watcher heartbeat reports ERROR', () => {
    const { output } = runPrecheck({
      state: holdInRangeState(10),
      heartbeat: {
        status: 'ERROR',
        at: secondsAgo(1),
        watcher_started_at: secondsAgo(11),
        watcher_finished_at: secondsAgo(1),
        consecutive_errors: 1,
        error: 'status command timed out',
      },
    });

    expect(output.wakeAgent).toBe(true);
    expect(output.actionRequired).toBe(false);
    expect(output.recommendedAction).toBe('ALERT_REVIEW_ONLY');
    expect(output.reason).toBe('watcher_error');
  });
});
