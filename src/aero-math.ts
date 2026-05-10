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
const SECONDS_PER_YEAR = 31_536_000;

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

export function priceToAdjustedTick(price: number, token0Decimals: number, token1Decimals: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.log(price / Math.pow(10, token0Decimals - token1Decimals)) / LOG_BASE;
}

export function alignTickDown(tick: number, tickSpacing: number): number {
  return Math.floor(tick / tickSpacing) * tickSpacing;
}

export function alignTickUp(tick: number, tickSpacing: number): number {
  return Math.ceil(tick / tickSpacing) * tickSpacing;
}

export interface PositionAmountEstimate {
  token0: number;
  token1: number;
}

export interface PositionAmountInput {
  liquidity: bigint | number;
  currentTick: number;
  lowerTick: number;
  upperTick: number;
  token0Decimals: number;
  token1Decimals: number;
}

export interface UsdBreakdown {
  token0Usd: number;
  token1Usd: number;
  totalUsd: number;
  token0Pct: number;
  token1Pct: number;
}

export interface EmissionAprInput {
  rewardRateRaw: bigint;
  rewardTokenDecimals: number;
  rewardTokenUsd: number;
  positionLiquidity: bigint | number;
  totalStakedLiquidity: bigint | number;
  positionUsd: number;
}

export interface ProfitabilityIndexInput {
  emissionAprPct?: number;
  feeAprPct?: number;
  volatilityPct?: number;
  impermanentLossPct?: number;
  pendingRewardsUsd?: number;
  portfolioUsd?: number;
  outOfRange?: boolean;
}

export function rawToDecimal(raw: bigint | number | string, decimals: number): number {
  if (typeof raw === 'number') return raw / 10 ** decimals;
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  const sign = value < 0n ? -1 : 1;
  const absolute = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = absolute % scale;
  return sign * (Number(whole) + Number(fraction) / 10 ** decimals);
}

export function estimatePositionTokenAmounts(input: PositionAmountInput): PositionAmountEstimate {
  const liquidity = typeof input.liquidity === 'bigint' ? Number(input.liquidity) : input.liquidity;
  if (!Number.isFinite(liquidity) || liquidity <= 0 || input.upperTick <= input.lowerTick) {
    return { token0: 0, token1: 0 };
  }

  const sqrtLower = Math.pow(1.0001, input.lowerTick / 2);
  const sqrtUpper = Math.pow(1.0001, input.upperTick / 2);
  const sqrtCurrent = Math.pow(1.0001, input.currentTick / 2);
  const sqrtPrice = Math.max(sqrtLower, Math.min(sqrtCurrent, sqrtUpper));

  let token0Raw = 0;
  let token1Raw = 0;
  if (input.currentTick < input.lowerTick) {
    token0Raw = liquidity * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
  } else if (input.currentTick >= input.upperTick) {
    token1Raw = liquidity * (sqrtUpper - sqrtLower);
  } else {
    token0Raw = liquidity * (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper);
    token1Raw = liquidity * (sqrtPrice - sqrtLower);
  }

  return {
    token0: token0Raw / 10 ** input.token0Decimals,
    token1: token1Raw / 10 ** input.token1Decimals,
  };
}

export function usdBreakdown(amounts: PositionAmountEstimate, token0PriceUsd: number, token1PriceUsd: number): UsdBreakdown {
  const token0Usd = amounts.token0 * token0PriceUsd;
  const token1Usd = amounts.token1 * token1PriceUsd;
  const totalUsd = token0Usd + token1Usd;
  return {
    token0Usd,
    token1Usd,
    totalUsd,
    token0Pct: totalUsd > 0 ? (token0Usd / totalUsd) * 100 : 0,
    token1Pct: totalUsd > 0 ? (token1Usd / totalUsd) * 100 : 0,
  };
}

export function formatUsd(value: number | null | undefined, precision = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}

export function emissionAprPct(input: EmissionAprInput): number {
  const rewardPerSecond = rawToDecimal(input.rewardRateRaw, input.rewardTokenDecimals);
  const totalStakedLiquidity = typeof input.totalStakedLiquidity === 'bigint' ? Number(input.totalStakedLiquidity) : input.totalStakedLiquidity;
  const positionLiquidity = typeof input.positionLiquidity === 'bigint' ? Number(input.positionLiquidity) : input.positionLiquidity;
  if (
    rewardPerSecond <= 0 ||
    input.rewardTokenUsd <= 0 ||
    input.positionUsd <= 0 ||
    totalStakedLiquidity <= 0 ||
    positionLiquidity <= 0
  ) {
    return 0;
  }
  const stakeShare = positionLiquidity / totalStakedLiquidity;
  const annualRewardUsd = rewardPerSecond * SECONDS_PER_YEAR * input.rewardTokenUsd * stakeShare;
  return (annualRewardUsd / input.positionUsd) * 100;
}

export function estimatedFeeAprPct(volume24hUsd: number | undefined, feePct: number, liquidityUsd: number | undefined): number | undefined {
  if (
    volume24hUsd === undefined ||
    liquidityUsd === undefined ||
    !Number.isFinite(volume24hUsd) ||
    !Number.isFinite(feePct) ||
    !Number.isFinite(liquidityUsd) ||
    volume24hUsd <= 0 ||
    feePct <= 0 ||
    liquidityUsd <= 0
  ) {
    return undefined;
  }
  return (volume24hUsd * feePct * 365 / liquidityUsd) * 100;
}

export function impermanentLossPct(priceRatio: number): number {
  if (!Number.isFinite(priceRatio) || priceRatio <= 0) return 0;
  return ((2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1) * 100;
}

export function holdVsLpPct(lpUsd: number | undefined, holdUsd: number | undefined): number | undefined {
  if (
    lpUsd === undefined ||
    holdUsd === undefined ||
    !Number.isFinite(lpUsd) ||
    !Number.isFinite(holdUsd) ||
    holdUsd <= 0
  ) {
    return undefined;
  }
  return (lpUsd / holdUsd - 1) * 100;
}

export function profitabilityIndex(input: ProfitabilityIndexInput): number {
  const emissionApr = input.emissionAprPct ?? 0;
  const feeApr = input.feeAprPct ?? 0;
  const volatilityPenalty = Math.max(0, input.volatilityPct ?? 0) * 0.35;
  const ilPenalty = Math.max(0, -(input.impermanentLossPct ?? 0)) * 0.65;
  const rangePenalty = input.outOfRange ? 15 : 0;
  const pendingBoost = input.pendingRewardsUsd && input.portfolioUsd && input.portfolioUsd > 0
    ? Math.min(25, (input.pendingRewardsUsd / input.portfolioUsd) * 100)
    : 0;
  return Math.max(0, emissionApr + feeApr + pendingBoost - volatilityPenalty - ilPenalty - rangePenalty);
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
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
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
