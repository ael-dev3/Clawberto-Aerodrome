import { describe, expect, it } from 'vitest';
import { normalizeWalletUptimeStats, updateWalletUptimeStats } from '../src/uptime';

const minute = 60_000;
const hour = 60 * minute;

describe('wallet range uptime', () => {
  it('counts the full wall-clock gap between successful observations', () => {
    const stats = updateWalletUptimeStats({
      firstSeenMs: 0,
      lastSeenMs: minute,
      lastState: 'inRange',
      inRangeMs: minute,
      outOfRangeMs: 0,
      noPositionMs: 0,
    }, 'inRange', 12 * hour);

    expect(stats.inRangeMs).toBe(12 * hour);
    expect(stats.outOfRangeMs).toBe(0);
    expect(stats.noPositionMs).toBe(0);
    expect(stats.lastSeenMs).toBe(12 * hour);
  });

  it('backfills persisted records that were previously undercounted', () => {
    const stats = normalizeWalletUptimeStats({
      firstSeenMs: 0,
      lastSeenMs: 12 * hour,
      lastState: 'inRange',
      inRangeMs: 90 * minute,
      outOfRangeMs: 46 * minute,
      noPositionMs: 0,
    });

    expect(stats).toBeDefined();
    expect(stats?.inRangeMs).toBe((12 * 60 - 46) * minute);
    expect(stats?.outOfRangeMs).toBe(46 * minute);
    expect(stats?.noPositionMs).toBe(0);
  });

  it('assigns elapsed time to the last observed state before switching state', () => {
    const stats = updateWalletUptimeStats({
      firstSeenMs: 0,
      lastSeenMs: hour,
      lastState: 'outOfRange',
      inRangeMs: hour,
      outOfRangeMs: 0,
      noPositionMs: 0,
    }, 'inRange', 2 * hour);

    expect(stats.inRangeMs).toBe(hour);
    expect(stats.outOfRangeMs).toBe(hour);
    expect(stats.lastState).toBe('inRange');
  });
});
