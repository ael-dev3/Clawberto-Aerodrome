import { describe, expect, it } from 'vitest';

import { priceWindowChanges, realizedVolatilityPct, suggestedLpRangeFromCandles, volatilityHeatmap } from '../src/analytics';
import { tickToAdjustedPrice } from '../src/aero-math';
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

  it('tightens suggested LP width when live emissions APR is high', () => {
    const currentTick = -365_879;
    const basePrice = tickToAdjustedPrice(currentTick, 18, 6);
    const stableCandles = Array.from({ length: 49 }, (_, index) => ({
      time: 1_700_000_000 + index * 3_600,
      open: basePrice * (1 + Math.sin(index / 3) * 0.002),
      high: basePrice * (1.01 + Math.sin(index / 3) * 0.002),
      low: basePrice * (0.99 + Math.sin(index / 3) * 0.002),
      close: basePrice * (1 + Math.sin(index / 3) * 0.002),
      volume: 1_000,
    }));
    const baseline = suggestedLpRangeFromCandles({
      candles: stableCandles,
      currentTick,
      tickSpacing: 200,
      token0Decimals: 18,
      token1Decimals: 6,
      emissionAprPct: 0,
    });
    const highEmission = suggestedLpRangeFromCandles({
      candles: stableCandles,
      currentTick,
      tickSpacing: 200,
      token0Decimals: 18,
      token1Decimals: 6,
      emissionAprPct: 500,
    });

    expect(highEmission.totalWidthPct).toBeLessThan(baseline.totalWidthPct);
    expect(highEmission.emissionTighteningPct).toBeGreaterThan(0);
  });

  it('builds a weekday-hour volatility heatmap from hourly candles', () => {
    const start = Date.UTC(2026, 0, 4, 0, 0, 0) / 1_000;
    let close = 100;
    const heatCandles = Array.from({ length: 14 * 24 }, (_, index) => {
      const time = start + index * 3_600;
      const date = new Date(time * 1_000);
      const isHighVolatilitySlot = date.getUTCDay() === 6 && date.getUTCHours() === 23;
      const open = close;
      close *= isHighVolatilitySlot ? 1.08 : 1.001;
      return {
        time,
        open,
        high: Math.max(open, close) * (isHighVolatilitySlot ? 1.03 : 1.0005),
        low: Math.min(open, close) * (isHighVolatilitySlot ? 0.97 : 0.9995),
        close,
        volume: 1_000,
      };
    });

    const heatmap = volatilityHeatmap(heatCandles);

    expect(heatmap.cells).toHaveLength(168);
    expect(heatmap.sampleCount).toBe(14 * 24 - 1);
    expect(heatmap.currentCell?.dayLabel).toBe('Sat');
    expect(heatmap.currentCell?.hour).toBe(23);
    expect(heatmap.currentRegimeMultiplier).toBeGreaterThan(1.2);
  });

  it('widens the suggested LP range during historically hot weekday-hour regimes', () => {
    const currentTick = -365_879;
    const basePrice = tickToAdjustedPrice(currentTick, 18, 6);
    const volatileCandles = Array.from({ length: 72 }, (_, index) => {
      const drift = Math.sin(index / 2) * 0.05;
      const close = basePrice * (1 + drift);
      return {
        time: 1_700_000_000 + index * 3_600,
        open: close,
        high: close * 1.015,
        low: close * 0.985,
        close,
        volume: 1_000,
      };
    });
    const baseline = suggestedLpRangeFromCandles({
      candles: volatileCandles,
      currentTick,
      tickSpacing: 200,
      token0Decimals: 18,
      token1Decimals: 6,
      emissionAprPct: 0,
      heatmapRegimeMultiplier: 1,
    });
    const hotRegime = suggestedLpRangeFromCandles({
      candles: volatileCandles,
      currentTick,
      tickSpacing: 200,
      token0Decimals: 18,
      token1Decimals: 6,
      emissionAprPct: 0,
      heatmapRegimeMultiplier: 1.6,
    });

    expect(hotRegime.totalWidthPct).toBeGreaterThan(baseline.totalWidthPct);
    expect(hotRegime.heatmapRegimeMultiplier).toBe(1.6);
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
          liquidity: 1_000_000n,
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

  it('does not draw LP overlays for closed zero-liquidity NFTs', () => {
    const snapshot = {
      pool: { currentTick: -365_879 },
      positions: [
        {
          tokenId: 345395n,
          label: 'Closed one-tick band',
          origin: 'hermes-managed',
          pair: 'LFI/USDC',
          tickLower: -364_600,
          tickUpper: -364_400,
          liquidity: 0n,
          setupTxs: [],
        },
      ],
    } as unknown as Pick<DashboardSnapshot, 'pool' | 'positions'>;

    expect(buildRangeOverlays(snapshot)).toHaveLength(0);
  });
});
