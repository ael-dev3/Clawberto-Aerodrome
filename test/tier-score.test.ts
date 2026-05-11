import { describe, expect, it } from 'vitest';
import { scoreWalletTiers } from '../src/tier-score';
import type { WalletUptimeStats } from '../src/uptime';

const hour = 60 * 60 * 1000;
const day = 24 * hour;

function uptime(inRangeMs: number, outOfRangeMs = 0, noPositionMs = 0): WalletUptimeStats {
  const total = inRangeMs + outOfRangeMs + noPositionMs;
  return {
    firstSeenMs: 0,
    lastSeenMs: total,
    lastState: noPositionMs > 0 ? 'noPosition' : outOfRangeMs > 0 ? 'outOfRange' : 'inRange',
    inRangeMs,
    outOfRangeMs,
    noPositionMs,
  };
}

describe('wallet tier scores', () => {
  it('weights historical uptime above live APR', () => {
    const [steady, highAprFlaky] = scoreWalletTiers([
      {
        id: 'steady',
        uptime: uptime(day),
        emissionAprPct: 22,
        feeAprPct: 2,
        lpUsd: 100,
      },
      {
        id: 'flaky',
        uptime: uptime(12 * hour, 12 * hour),
        emissionAprPct: 180,
        feeAprPct: 20,
        lpUsd: 100,
      },
    ]);

    expect(steady.score).toBeGreaterThan(highAprFlaky.score);
  });

  it('does not allow S tier on short history', () => {
    const [score] = scoreWalletTiers([{
      id: 'fresh',
      uptime: uptime(day),
      emissionAprPct: 400,
      feeAprPct: 40,
      lpUsd: 100,
    }]);

    expect(score.tier).not.toBe('S');
  });

  it('treats 80 percent uptime as respectable for a narrow LP after real history', () => {
    const [score] = scoreWalletTiers([{
      id: 'narrow',
      uptime: uptime(19.2 * hour, 4.8 * hour),
      emissionAprPct: 22,
      feeAprPct: 2,
      lpUsd: 100,
    }]);

    expect(score.uptimePct).toBeCloseTo(80, 1);
    expect(score.tier).toBe('B');
  });

  it('does not punish 80 percent uptime into D tier during early tracking', () => {
    const [score] = scoreWalletTiers([{
      id: 'fresh-narrow',
      uptime: uptime(4.8 * hour, 1.2 * hour),
      emissionAprPct: 22,
      feeAprPct: 2,
      lpUsd: 100,
    }]);

    expect(score.uptimePct).toBeCloseTo(80, 1);
    expect(score.tier).toBe('C');
  });

  it('keeps S tier reserved for long, near-perfect uptime and strong yield', () => {
    const [score] = scoreWalletTiers([{
      id: 'elite',
      uptime: uptime(7 * day),
      emissionAprPct: 400,
      feeAprPct: 40,
      lpUsd: 100,
    }]);

    expect(score.tier).toBe('S');
    expect(score.uptimePct).toBe(100);
  });
});
