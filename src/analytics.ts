import {
  alignTickDown,
  alignTickUp,
  priceToAdjustedTick,
  tickToAdjustedPrice,
} from './aero-math';
import type { GeckoCandle } from './gecko';

export const PRICE_CHANGE_WINDOWS = [1, 2, 6, 12, 24, 48] as const;
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

export function suggestedLpRangeFromCandles(input: {
  candles: GeckoCandle[];
  currentTick: number;
  tickSpacing: number;
  token0Decimals: number;
  token1Decimals: number;
  emissionAprPct?: number;
}): SuggestedLpRange {
  const currentPrice = tickToAdjustedPrice(input.currentTick, input.token0Decimals, input.token1Decimals);
  const volatility = realizedVolatilityPct(input.candles, 24);
  const observedMove = observedMovePct(input.candles, currentPrice, 48);
  const volatilityWidthPct = Math.max(12, volatility * 2, observedMove * 1.1);
  const emissionApr = input.emissionAprPct !== undefined && Number.isFinite(input.emissionAprPct)
    ? Math.max(0, input.emissionAprPct)
    : undefined;
  const emissionTighteningPct = emissionApr === undefined
    ? 0
    : Math.min(42, Math.log10(1 + emissionApr) * 12);
  const minimumWidthPct = Math.max(6, volatility * 0.75);
  const halfWidthPct = Math.min(85, Math.max(minimumWidthPct, volatilityWidthPct * (1 - emissionTighteningPct / 100)));
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
  };
}
