import {
  alignTickDown,
  alignTickUp,
  estimatePositionTokenAmounts,
  priceToAdjustedTick,
  rawToDecimal,
  tickToAdjustedPrice,
} from './aero-math';
import type { GeckoCandle } from './gecko';

export const PRICE_CHANGE_WINDOWS = [1, 2, 6, 12, 24, 48] as const;
export const HISTORICAL_HOURLY_CANDLE_LIMIT = 336;
export const VOLATILITY_HEATMAP_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type PriceChangeWindow = (typeof PRICE_CHANGE_WINDOWS)[number];

export interface PriceWindowChange {
  hours: PriceChangeWindow;
  fromPrice?: number;
  toPrice?: number;
  changePct?: number;
}

export interface SuggestedLpRange {
  lowerPrice: number;
  upperPrice: number;
  lowerTick: number;
  upperTick: number;
  halfWidthPct: number;
  totalWidthPct: number;
  realizedVolatilityPct: number;
  observedMovePct: number;
  emissionAprPct?: number;
  emissionTighteningPct: number;
  volatilityWidthPct: number;
  heatmapRegimeMultiplier: number;
  heatmapCurrentVolatilityPct?: number;
  modeledEmissionAprPct?: number;
  capitalEfficiencyPct?: number;
}

export interface VolatilityHeatmapCell {
  dayIndex: number;
  dayLabel: string;
  hour: number;
  sampleCount: number;
  volatilityPct: number;
  normalized: number;
  isCurrent: boolean;
}

export interface VolatilityHeatmap {
  cells: VolatilityHeatmapCell[];
  currentCell?: VolatilityHeatmapCell;
  averageVolatilityPct: number;
  maxVolatilityPct: number;
  currentRegimeMultiplier: number;
  sampleCount: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface EmissionRangeModel {
  rewardRateRaw: bigint;
  rewardTokenUsd: number;
  totalStakedLiquidity: bigint;
  rewardTokenDecimals?: number;
}

function latestClose(candles: GeckoCandle[]): GeckoCandle | undefined {
  return [...candles].sort((a, b) => a.time - b.time).at(-1);
}

function candleAtOrBefore(candles: GeckoCandle[], timestamp: number): GeckoCandle | undefined {
  return [...candles]
    .sort((a, b) => a.time - b.time)
    .filter((candle) => candle.time <= timestamp)
    .at(-1);
}

export function priceWindowChanges(candles: GeckoCandle[], windows: readonly PriceChangeWindow[] = PRICE_CHANGE_WINDOWS): PriceWindowChange[] {
  const latest = latestClose(candles);
  return windows.map((hours) => {
    if (!latest) return { hours };
    const from = candleAtOrBefore(candles, latest.time - hours * 3_600);
    if (!from || from.close <= 0) return { hours, toPrice: latest.close };
    return {
      hours,
      fromPrice: from.close,
      toPrice: latest.close,
      changePct: (latest.close / from.close - 1) * 100,
    };
  });
}

export function realizedVolatilityPct(candles: GeckoCandle[], hours = 24): number {
  const latest = latestClose(candles);
  if (!latest) return 0;
  const cutoff = latest.time - hours * 3_600;
  const closes = candles
    .filter((candle) => candle.time >= cutoff && candle.close > 0)
    .sort((a, b) => a.time - b.time)
    .map((candle) => candle.close);
  if (closes.length < 3) return 0;

  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(returns.length) * 100;
}

export function observedMovePct(candles: GeckoCandle[], currentPrice: number, hours = 48): number {
  const latest = latestClose(candles);
  if (!latest || currentPrice <= 0) return 0;
  const cutoff = latest.time - hours * 3_600;
  const window = candles.filter((candle) => candle.time >= cutoff);
  if (window.length === 0) return 0;
  const high = Math.max(...window.map((candle) => candle.high));
  const low = Math.min(...window.map((candle) => candle.low));
  return Math.max(Math.abs(high / currentPrice - 1), Math.abs(low / currentPrice - 1)) * 100;
}

export function volatilityHeatmap(candles: GeckoCandle[]): VolatilityHeatmap {
  const sorted = candles
    .filter((candle) => candle.time > 0 && candle.close > 0)
    .sort((a, b) => a.time - b.time);
  const buckets = Array.from({ length: VOLATILITY_HEATMAP_DAYS.length * 24 }, () => ({ sum: 0, count: 0 }));

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const candle = sorted[index];
    const elapsedHours = (candle.time - previous.time) / 3_600;
    if (elapsedHours <= 0 || elapsedHours > 6 || previous.close <= 0) continue;

    const closeMovePct = Math.abs(Math.log(candle.close / previous.close)) * 100 / Math.sqrt(elapsedHours);
    const candleRangePct = candle.high > 0 && candle.low > 0 && candle.high >= candle.low
      ? Math.log(candle.high / candle.low) * 100 / Math.sqrt(elapsedHours)
      : 0;
    const hourlyVolatilityPct = Math.max(closeMovePct, candleRangePct * 0.55);
    const date = new Date(candle.time * 1_000);
    const bucketIndex = date.getUTCDay() * 24 + date.getUTCHours();
    buckets[bucketIndex].sum += hourlyVolatilityPct;
    buckets[bucketIndex].count += 1;
  }

  const observed = buckets
    .map((bucket) => (bucket.count > 0 ? bucket.sum / bucket.count : undefined))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const sampleCount = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const averageVolatilityPct = observed.length > 0
    ? observed.reduce((sum, value) => sum + value, 0) / observed.length
    : 0;
  const maxVolatilityPct = observed.length > 0 ? Math.max(...observed) : 0;
  const latest = sorted.at(-1);
  const currentDay = latest ? new Date(latest.time * 1_000).getUTCDay() : undefined;
  const currentHour = latest ? new Date(latest.time * 1_000).getUTCHours() : undefined;

  const cells = buckets.map((bucket, bucketIndex) => {
    const dayIndex = Math.floor(bucketIndex / 24);
    const hour = bucketIndex % 24;
    const volatilityPct = bucket.count > 0 ? bucket.sum / bucket.count : 0;
    return {
      dayIndex,
      dayLabel: VOLATILITY_HEATMAP_DAYS[dayIndex],
      hour,
      sampleCount: bucket.count,
      volatilityPct,
      normalized: maxVolatilityPct > 0 ? clamp(volatilityPct / maxVolatilityPct, 0, 1) : 0,
      isCurrent: dayIndex === currentDay && hour === currentHour,
    };
  });
  const currentCell = cells.find((cell) => cell.isCurrent);
  const currentRegimeMultiplier = currentCell && currentCell.sampleCount > 0 && averageVolatilityPct > 0
    ? clamp(currentCell.volatilityPct / averageVolatilityPct, 0.75, 1.6)
    : 1;

  return {
    cells,
    currentCell,
    averageVolatilityPct,
    maxVolatilityPct,
    currentRegimeMultiplier,
    sampleCount,
  };
}

export function suggestedLpRangeFromCandles(input: {
  candles: GeckoCandle[];
  currentTick: number;
  tickSpacing: number;
  token0Decimals: number;
  token1Decimals: number;
  emissionAprPct?: number;
  emissionModel?: EmissionRangeModel;
  heatmapRegimeMultiplier?: number;
}): SuggestedLpRange {
  const currentPrice = tickToAdjustedPrice(input.currentTick, input.token0Decimals, input.token1Decimals);
  const volatility = realizedVolatilityPct(input.candles, 24);
  const observedMove = observedMovePct(input.candles, currentPrice, 48);
  const heatmap = input.heatmapRegimeMultiplier === undefined
    ? volatilityHeatmap(input.candles)
    : undefined;
  const heatmapRegimeMultiplier = clamp(input.heatmapRegimeMultiplier ?? heatmap?.currentRegimeMultiplier ?? 1, 0.75, 1.6);
  const heatmapAdjustedVolatility = volatility * heatmapRegimeMultiplier;
  const heatmapAdjustedObservedMove = observedMove * Math.sqrt(heatmapRegimeMultiplier);
  const volatilityWidthPct = Math.max(6, heatmapAdjustedVolatility * 0.55, heatmapAdjustedObservedMove * 0.42);
  const emissionApr = input.emissionAprPct !== undefined && Number.isFinite(input.emissionAprPct)
    ? Math.max(0, input.emissionAprPct)
    : undefined;
  const emissionTighteningPct = emissionApr === undefined
    ? 0
    : Math.min(58, Math.log10(1 + emissionApr) * 15);
  const minimumWidthPct = Math.max(3, heatmapAdjustedVolatility * 0.18);
  const heuristicHalfWidthPct = Math.min(55, Math.max(minimumWidthPct, volatilityWidthPct * (1 - emissionTighteningPct / 100)));

  const candidate = bestRangeCandidate({
    currentPrice,
    currentTick: input.currentTick,
    tickSpacing: input.tickSpacing,
    token0Decimals: input.token0Decimals,
    token1Decimals: input.token1Decimals,
    riskHalfWidthPct: volatilityWidthPct,
    heuristicHalfWidthPct,
    emissionModel: input.emissionModel,
  });
  const halfWidthPct = candidate?.halfWidthPct ?? heuristicHalfWidthPct;
  const lowerPrice = currentPrice * Math.max(0.01, 1 - halfWidthPct / 100);
  const upperPrice = currentPrice * (1 + halfWidthPct / 100);
  const lowerTick = alignTickDown(priceToAdjustedTick(lowerPrice, input.token0Decimals, input.token1Decimals), input.tickSpacing);
  const upperTick = alignTickUp(priceToAdjustedTick(upperPrice, input.token0Decimals, input.token1Decimals), input.tickSpacing);

  return {
    lowerTick,
    upperTick,
    lowerPrice: tickToAdjustedPrice(lowerTick, input.token0Decimals, input.token1Decimals),
    upperPrice: tickToAdjustedPrice(upperTick, input.token0Decimals, input.token1Decimals),
    halfWidthPct,
    totalWidthPct: halfWidthPct * 2,
    realizedVolatilityPct: volatility,
    observedMovePct: observedMove,
    emissionAprPct: emissionApr,
    emissionTighteningPct,
    volatilityWidthPct,
    heatmapRegimeMultiplier,
    heatmapCurrentVolatilityPct: heatmap?.currentCell?.sampleCount ? heatmap.currentCell.volatilityPct : undefined,
    modeledEmissionAprPct: candidate?.modeledEmissionAprPct,
    capitalEfficiencyPct: candidate?.capitalEfficiencyPct,
  };
}

function modeledEmissionAprForRange(input: {
  currentTick: number;
  lowerTick: number;
  upperTick: number;
  token0Decimals: number;
  token1Decimals: number;
  token0Usd: number;
  token1Usd: number;
  emissionModel: EmissionRangeModel;
}): number | undefined {
  const unitLiquidity = 1_000_000_000_000_000_000n;
  const amounts = estimatePositionTokenAmounts({
    liquidity: unitLiquidity,
    currentTick: input.currentTick,
    lowerTick: input.lowerTick,
    upperTick: input.upperTick,
    token0Decimals: input.token0Decimals,
    token1Decimals: input.token1Decimals,
  });
  const unitUsd = amounts.token0 * input.token0Usd + amounts.token1 * input.token1Usd;
  const totalStakedLiquidity = Number(input.emissionModel.totalStakedLiquidity);
  if (
    unitUsd <= 0 ||
    totalStakedLiquidity <= 0 ||
    input.emissionModel.rewardTokenUsd <= 0
  ) {
    return undefined;
  }
  const rewardPerSecond = rawToDecimal(input.emissionModel.rewardRateRaw, input.emissionModel.rewardTokenDecimals ?? 18);
  const liquidityPerDollar = Number(unitLiquidity) / unitUsd;
  const annualRewardUsd = rewardPerSecond * 31_536_000 * input.emissionModel.rewardTokenUsd;
  return annualRewardUsd * (liquidityPerDollar / totalStakedLiquidity) * 100;
}

function bestRangeCandidate(input: {
  currentPrice: number;
  currentTick: number;
  tickSpacing: number;
  token0Decimals: number;
  token1Decimals: number;
  riskHalfWidthPct: number;
  heuristicHalfWidthPct: number;
  emissionModel?: EmissionRangeModel;
}): { halfWidthPct: number; modeledEmissionAprPct?: number; capitalEfficiencyPct?: number } | undefined {
  if (!input.emissionModel) return undefined;
  const candidates: Array<{ halfWidthPct: number; modeledEmissionAprPct: number; score: number }> = [];
  const maxHalfWidth = Math.max(14, Math.min(45, input.heuristicHalfWidthPct * 1.35));
  for (let halfWidthPct = 3; halfWidthPct <= maxHalfWidth; halfWidthPct += 0.5) {
    const lowerPrice = input.currentPrice * Math.max(0.01, 1 - halfWidthPct / 100);
    const upperPrice = input.currentPrice * (1 + halfWidthPct / 100);
    const lowerTick = alignTickDown(priceToAdjustedTick(lowerPrice, input.token0Decimals, input.token1Decimals), input.tickSpacing);
    const upperTick = alignTickUp(priceToAdjustedTick(upperPrice, input.token0Decimals, input.token1Decimals), input.tickSpacing);
    if (upperTick <= lowerTick) continue;
    const modeledEmissionAprPct = modeledEmissionAprForRange({
      currentTick: input.currentTick,
      lowerTick,
      upperTick,
      token0Decimals: input.token0Decimals,
      token1Decimals: input.token1Decimals,
      token0Usd: input.currentPrice,
      token1Usd: 1,
      emissionModel: input.emissionModel,
    });
    if (modeledEmissionAprPct === undefined) continue;
    candidates.push({ halfWidthPct, modeledEmissionAprPct, score: 0 });
  }
  if (candidates.length === 0) return undefined;
  const maxApr = Math.max(...candidates.map((candidate) => candidate.modeledEmissionAprPct), 0);
  if (maxApr <= 0) return undefined;

  let best = candidates[0];
  for (const candidate of candidates) {
    const coverage = clamp(candidate.halfWidthPct / Math.max(1, input.riskHalfWidthPct), 0, 1);
    const aprRetention = clamp(candidate.modeledEmissionAprPct / maxApr, 0, 1);
    const widthPenalty = candidate.halfWidthPct / maxHalfWidth;
    candidate.score = coverage * 0.46 + aprRetention * 0.5 - widthPenalty * 0.08;
    if (candidate.score > best.score) best = candidate;
  }

  return {
    halfWidthPct: best.halfWidthPct,
    modeledEmissionAprPct: best.modeledEmissionAprPct,
    capitalEfficiencyPct: (best.modeledEmissionAprPct / maxApr) * 100,
  };
}
