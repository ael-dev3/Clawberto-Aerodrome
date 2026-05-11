import { describe, expect, it } from 'vitest';
import oldOneCronPlist from '../ops/launchd/com.clawberto.aerodrome.onecron.plist?raw';
import watcherPlist from '../ops/launchd/com.clawberto.aerodrome.watcher.plist?raw';
import oldOneCronWrapper from '../scripts/aerodrome-one-cron-launchd.sh?raw';
import watcherScript from '../scripts/aerodrome-lp-watcher.mjs?raw';
import watcherWrapper from '../scripts/aerodrome-lp-watcher-launchd.sh?raw';
import supervisorPrecheck from '../scripts/aerodrome-lp-supervisor-precheck.py?raw';

describe('Aerodrome deterministic watcher + Hermes supervisor architecture', () => {
  it('retires the old signer-backed launchd executor from automatic scheduling', () => {
    expect(oldOneCronPlist).toContain('<key>Disabled</key>');
    expect(oldOneCronPlist).toContain('<true/>');
    expect(oldOneCronWrapper).toContain('retired');
    expect(oldOneCronWrapper).not.toContain('--cron');
  });

  it('runs a deterministic local watcher every 15 seconds outside Hermes', () => {
    expect(watcherPlist).toContain('<key>StartInterval</key>');
    expect(watcherPlist).toContain('<integer>15</integer>');
    expect(watcherWrapper).toContain('node scripts/aerodrome-lp-watcher.mjs');
    expect(watcherWrapper).not.toMatch(/git\s+(pull|status|push|commit|add)\b/);
    expect(watcherWrapper).not.toContain('--cron');
  });

  it('keeps the watcher read-only and range-aware with cooldown/action caps', () => {
    expect(watcherScript).toContain("'--status'");
    expect(watcherScript).not.toContain("'--cron'");
    expect(watcherScript).toContain('trigger_at_percent_of_half_width: 0.20');
    expect(watcherScript).toContain('hard_exit_at_percent_of_half_width: 0.05');
    expect(watcherScript).toContain('min_rebalance_cooldown_seconds: 600');
    expect(watcherScript).toContain('max_actions_per_run: 1');
    expect(watcherScript).toContain('gas_reserve_usd: 1.5');
    expect(watcherScript).toContain('idle_redeploy_threshold_usd: 2.0');
    expect(watcherScript).toContain('idle_capital_exceeds_threshold');
    expect(watcherScript).toContain('wakeAgent');
  });

  it('uses a Hermes precheck script that suppresses the agent unless state is actionable', () => {
    expect(supervisorPrecheck).toContain('wakeAgent');
    expect(supervisorPrecheck).toContain('state_max_age_seconds');
    expect(supervisorPrecheck).toContain('max_actions_per_run');
    expect(supervisorPrecheck).toContain('wakeAgent = False');
    expect(supervisorPrecheck).not.toContain('eth_sendTransaction');
  });
});
