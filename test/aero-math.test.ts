import { describe, expect, it } from 'vitest';

import {
  alignFiftyPercentRange,
  decodeSignedWord,
  emissionAprPct,
  estimatedFeeAprPct,
  estimatePositionTokenAmounts,
  formatTokenAmount,
  formatUsd,
  impermanentLossPct,
  priceToAdjustedTick,
  profitabilityIndex,
  rangeStatus,
  tickToAdjustedPrice,
  usdBreakdown,
} from '../src/aero-math';
import { CONTRACTS } from '../src/config';
import { DASHBOARD_SECTION_ORDER } from '../src/dashboard-layout';
import { positionValuation } from '../src/position-valuation';
import type { DashboardSnapshot, LivePosition } from '../src/rpc';

describe('Aerodrome CL math', () => {
  it('aligns a 50 percent price band to CL200 ticks', () => {
    expect(alignFiftyPercentRange(-365879, 200)).toEqual({
      currentTick: -365879,
      lowerTick: -373000,
      upperTick: -361800,
    });
  });

  it('reports in-range tick headroom against both edges', () => {
    const status = rangeStatus(-365879, -373000, -361800);
    expect(status.state).toBe('IN_RANGE');
    expect(status.tickDistanceToLower).toBe(7121);
    expect(status.tickDistanceToUpper).toBe(4079);
    expect(status.lowerHeadroomPct).toBeGreaterThan(63);
    expect(status.upperHeadroomPct).toBeGreaterThan(36);
    expect(status.upperHeadroomPct).toBeLessThan(37);
  });

  it('converts tick to human USDC per LFI with decimal skew', () => {
    const price = tickToAdjustedPrice(-365879, 18, 6);
    expect(price).toBeGreaterThan(0.00012);
    expect(price).toBeLessThan(0.00013);
    expect(Math.round(priceToAdjustedTick(price, 18, 6))).toBe(-365879);
  });

  it('formats raw token amounts from bigint balances', () => {
    expect(formatTokenAmount(9731554156611989780999n, 18, 4)).toBe('9,731.5542');
    expect(formatTokenAmount(2000000n, 6, 2)).toBe('2.00');
  });

  it('decodes twos-complement int24 words from EVM logs', () => {
    expect(decodeSignedWord('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa4ef8')).toBe(-373000);
    expect(decodeSignedWord('0x00000000000000000000000000000000000000000000000000000000000000c8')).toBe(200);
  });

  it('estimates active CL token amounts and USD value for each side', () => {
    const amounts = estimatePositionTokenAmounts({
      liquidity: 1_000_000n,
      currentTick: 0,
      lowerTick: -100,
      upperTick: 100,
      token0Decimals: 0,
      token1Decimals: 0,
    });
    expect(amounts.token0).toBeCloseTo(4987.27, 2);
    expect(amounts.token1).toBeCloseTo(4987.27, 2);

    const usd = usdBreakdown(amounts, 0.25, 1);
    expect(usd.token0Usd).toBeCloseTo(1246.82, 2);
    expect(usd.token1Usd).toBeCloseTo(4987.27, 2);
    expect(usd.totalUsd).toBeCloseTo(6234.09, 2);
    expect(formatUsd(usd.totalUsd)).toBe('$6,234.09');
  });

  it('estimates emissions APR from gauge reward rate, stake share, and position value', () => {
    const apr = emissionAprPct({
      rewardRateRaw: 100_000_000_000_000n,
      rewardTokenDecimals: 18,
      rewardTokenUsd: 0.5,
      positionLiquidity: 25n,
      totalStakedLiquidity: 100n,
      positionUsd: 1_000,
    });
    expect(apr).toBeCloseTo(39.42, 2);
  });

  it('does not assign emissions APR to unstaked wallet-held LP NFTs', () => {
    const snapshot = {
      pool: {
        currentTick: 0,
        rewardRate: 1_000_000_000_000_000_000n,
        stakedLiquidity: 1_000_000_000_000_000_000n,
      },
      market: {
        aeroUsd: 0.5,
        lfiUsd: 1,
      },
    } as unknown as DashboardSnapshot;
    const basePosition = {
      tokenId: 1n,
      label: 'Test LP',
      origin: 'hermes-managed',
      pair: 'LFI/USDC',
      pool: CONTRACTS.pool,
      gauge: CONTRACTS.gauge,
      nftManager: CONTRACTS.nftManager,
      enteredAt: 'test',
      intendedRange: 'test',
      notes: 'test',
      token0: CONTRACTS.lfi,
      token1: CONTRACTS.usdc,
      tickLower: -100,
      tickUpper: 100,
      liquidity: 1_000_000_000_000_000_000n,
      setupTxs: [],
    } as LivePosition;

    expect(positionValuation({ ...basePosition, staked: false }, snapshot).aprPct).toBeUndefined();
    expect(positionValuation({ ...basePosition, staked: true }, snapshot).aprPct).toBeGreaterThan(0);
  });

  it('estimates fee APR, IL, and profitability index without cost-basis assumptions', () => {
    expect(estimatedFeeAprPct(100_000, 0.0001, 1_000_000)).toBeCloseTo(0.365, 3);
    expect(impermanentLossPct(2)).toBeCloseTo(-5.72, 2);
    expect(profitabilityIndex({
      emissionAprPct: 50,
      feeAprPct: 10,
      volatilityPct: 20,
      impermanentLossPct: -5,
      pendingRewardsUsd: 5,
      portfolioUsd: 100,
    })).toBeCloseTo(54.75, 2);
  });

  it('keeps LP range as the first dashboard content section', () => {
    expect(DASHBOARD_SECTION_ORDER[0]).toBe('range-control');
    expect(DASHBOARD_SECTION_ORDER[1]).toBe('analytics-bottom');
    expect(DASHBOARD_SECTION_ORDER.at(-1)).toBe('diagnostics-secondary');
  });
});
