import { describe, expect, it } from 'vitest';

import { priceWindowChanges, realizedVolatilityPct, suggestedLpRangeFromCandles } from '../src/analytics';
import { normalizeGeckoOhlcv } from '../src/gecko';
import { buildRangeOverlays } from '../src/lp-range-overlays';
import type { DashboardSnapshot } from '../src/rpc';

describe('GeckoTerminal candle normalization', () => {
  it('sorts OHLCV candles ascending and drops invalid rows', () => {
    const candles = normalizeGeckoOhlcv({
      data: {
        attributes: {
          ohlcv_list: [
            [200, '0.2', '0.3', '0.1', '0.25', '100'],
            ['bad', 1, 1, 1, 1, 1],
            [100, 0.1, 0.2, 0.09, 0.15, 90],
            [100, 9, 9, 9, 9, 9],
          ],
        },
      },
    });

    expect(candles).toEqual([
      { time: 100, open: 0.1, high: 0.2, low: 0.09, close: 0.15, volume: 90 },
      { time: 200, open: 0.2, high: 0.3, low: 0.1, close: 0.25, volume: 100 },
    ]);
  });
});

describe('LFI analytics windows', () => {
  const candles = Array.from({ length: 49 }, (_, index) => ({
    time: 1_700_000_000 + index * 3_600,
    open: 100 + index,
    high: 102 + index,
    low: 98 + index,
    close: 100 + index,
    volume: 1_000,
  }));

  it('calculates critical hourly price changes', () => {
    const changes = priceWindowChanges(candles);
    expect(changes.find((change) => change.hours === 1)?.changePct).toBeCloseTo(0.68, 2);
    expect(changes.find((change) => change.hours === 48)?.changePct).toBeCloseTo(48, 2);
  });

  it('builds an aligned volatility range from candles', () => {
    const suggestion = suggestedLpRangeFromCandles({
      candles,
      currentTick: -365_879,
      tickSpacing: 200,
      token0Decimals: 18,
      token1Decimals: 6,
    });
    expect(realizedVolatilityPct(candles, 24)).toBeGreaterThan(0);
    expect(Math.abs(suggestion.lowerTick % 200)).toBe(0);
    expect(Math.abs(suggestion.upperTick % 200)).toBe(0);
    expect(suggestion.lowerPrice).toBeLessThan(suggestion.upperPrice);
  });
});

describe('LP price overlays', () => {
  it('maps readable NFT ticks into USDC price bands', () => {
    const snapshot = {
      pool: {
        currentTick: -365_879,
      },
      positions: [
        {
          tokenId: 341439n,
          label: 'Hermes CL200 50% band',
          origin: 'hermes-managed',
          pair: 'LFI/USDC',
          tickLower: -373_000,
          tickUpper: -361_800,
          setupTxs: [],
        },
        {
          tokenId: 341002n,
          label: 'Unreadable position',
          origin: 'ael-existing',
          pair: 'LFI/USDC',
          liveError: 'ownerOf failed',
          setupTxs: [],
        },
      ],
    } as unknown as Pick<DashboardSnapshot, 'pool' | 'positions'>;

    const overlays = buildRangeOverlays(snapshot);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].tokenId).toBe('341439');
    expect(overlays[0].lowerPrice).toBeLessThan(overlays[0].upperPrice);
    expect(overlays[0].status.state).toBe('IN_RANGE');
  });
});
