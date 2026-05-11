import { describe, expect, it } from 'vitest';
import { activePositionSetKey, normalizeWalletPnlRecord, updateWalletPnlRecord } from '../src/pnl-tracking';

describe('wallet PnL tracking', () => {
  it('creates an exact zero PnL baseline on first observation', () => {
    const update = updateWalletPnlRecord(undefined, {
      walletKey: '0xABC',
      positionSetKey: activePositionSetKey([10n]),
      totalUsd: 125.25,
      nowMs: 1_000,
    });

    expect(update.record.walletKey).toBe('0xabc');
    expect(update.snapshot.baselineUsd).toBe(125.25);
    expect(update.snapshot.pnlUsd).toBe(0);
    expect(update.snapshot.pnlPct).toBe(0);
    expect(update.snapshot.isNewBaseline).toBe(true);
  });

  it('measures overall balance changes against the same position set baseline', () => {
    const first = updateWalletPnlRecord(undefined, {
      walletKey: '0xabc',
      positionSetKey: activePositionSetKey([10n, 2n]),
      totalUsd: 100,
      nowMs: 1_000,
    });
    const second = updateWalletPnlRecord(first.record, {
      walletKey: '0xabc',
      positionSetKey: activePositionSetKey([2n, 10n]),
      totalUsd: 112.5,
      nowMs: 2_000,
    });

    expect(second.snapshot.isNewBaseline).toBe(false);
    expect(second.snapshot.pnlUsd).toBe(12.5);
    expect(second.snapshot.pnlPct).toBe(12.5);
  });

  it('resets the baseline when the active NFT set changes', () => {
    const first = updateWalletPnlRecord(undefined, {
      walletKey: '0xabc',
      positionSetKey: activePositionSetKey([10n]),
      totalUsd: 100,
      nowMs: 1_000,
    });
    const second = updateWalletPnlRecord(first.record, {
      walletKey: '0xabc',
      positionSetKey: activePositionSetKey([11n]),
      totalUsd: 95,
      nowMs: 2_000,
    });

    expect(second.snapshot.isNewBaseline).toBe(true);
    expect(second.snapshot.baselineUsd).toBe(95);
    expect(second.snapshot.pnlUsd).toBe(0);
  });

  it('rejects malformed persisted records', () => {
    expect(normalizeWalletPnlRecord({
      walletKey: '0xabc',
      positionSetKey: '10',
      baselineUsd: -1,
      baselineAtMs: 1_000,
      lastSeenMs: 1_000,
      lastTotalUsd: 100,
    })).toBeUndefined();
  });
});
