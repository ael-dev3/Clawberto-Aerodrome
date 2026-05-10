export type RangeState = 'IN_RANGE' | 'BELOW_RANGE' | 'ABOVE_RANGE';

export interface AlignedRange {
  currentTick: number;
  lowerTick: number;
  upperTick: number;
}

export interface RangeStatus {
  state: RangeState;
  tickDistanceToLower: number;
  tickDistanceToUpper: number;
  widthTicks: number;
  progressPct: number;
  lowerHeadroomPct: number;
  upperHeadroomPct: number;
}

const LOG_BASE = Math.log(1.0001);

export function alignFiftyPercentRange(currentTick: number, tickSpacing: number): AlignedRange {
  const lowerRaw = currentTick + Math.log(0.5) / LOG_BASE;
  const upperRaw = currentTick + Math.log(1.5) / LOG_BASE;
  return {
    currentTick,
    lowerTick: Math.floor(lowerRaw / tickSpacing) * tickSpacing,
    upperTick: Math.ceil(upperRaw / tickSpacing) * tickSpacing,
  };
}

export function rangeStatus(currentTick: number, lowerTick: number, upperTick: number): RangeStatus {
  const widthTicks = upperTick - lowerTick;
  const tickDistanceToLower = currentTick - lowerTick;
  const tickDistanceToUpper = upperTick - currentTick;
  const state: RangeState = currentTick < lowerTick ? 'BELOW_RANGE' : currentTick >= upperTick ? 'ABOVE_RANGE' : 'IN_RANGE';
  const clampedProgress = Math.max(0, Math.min(1, (currentTick - lowerTick) / widthTicks));
  return {
    state,
    tickDistanceToLower,
    tickDistanceToUpper,
    widthTicks,
    progressPct: clampedProgress * 100,
    lowerHeadroomPct: Math.max(0, tickDistanceToLower / widthTicks) * 100,
    upperHeadroomPct: Math.max(0, tickDistanceToUpper / widthTicks) * 100,
  };
}

export function tickToAdjustedPrice(tick: number, token0Decimals: number, token1Decimals: number): number {
  return Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
}

export function formatTokenAmount(raw: bigint | number | string, decimals: number, precision = 4): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const roundingFactor = precision < decimals ? 10n ** BigInt(decimals - precision) : 1n;
  const rounded = precision < decimals ? ((value + roundingFactor / 2n) / roundingFactor) * roundingFactor : value;
  const whole = rounded / scale;
  const fraction = rounded % scale;
  const fractionText = fraction.toString().padStart(decimals, '0').slice(0, precision);
  const withCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return precision === 0 ? withCommas : `${withCommas}.${fractionText.padEnd(precision, '0')}`;
}

export function compactAddress(address: string, head = 6, tail = 4): string {
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function decodeSignedWord(hexWord: string): number {
  const raw = BigInt(hexWord);
  const masked = raw & ((1n << 24n) - 1n);
  const signBit = 1n << 23n;
  const signed = (masked & signBit) === 0n ? masked : masked - (1n << 24n);
  return Number(signed);
}

export function percentFormat(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(digits)}%`;
}

export function tickLabel(tick: number): string {
  return tick.toLocaleString('en-US');
}
