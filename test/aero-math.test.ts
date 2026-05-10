import { describe, expect, it } from 'vitest';

import {
  alignFiftyPercentRange,
  decodeSignedWord,
  formatTokenAmount,
  rangeStatus,
  tickToAdjustedPrice,
} from '../src/aero-math';

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
  });

  it('formats raw token amounts from bigint balances', () => {
    expect(formatTokenAmount(9731554156611989780999n, 18, 4)).toBe('9,731.5542');
    expect(formatTokenAmount(2000000n, 6, 2)).toBe('2.00');
  });

  it('decodes twos-complement int24 words from EVM logs', () => {
    expect(decodeSignedWord('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa4ef8')).toBe(-373000);
    expect(decodeSignedWord('0x00000000000000000000000000000000000000000000000000000000000000c8')).toBe(200);
  });
});
