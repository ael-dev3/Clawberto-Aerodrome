import type { Address } from 'viem';

import { CONTRACTS } from './config';

const GECKO_API_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_NETWORK = 'base';
const CANDLE_CACHE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface GeckoCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CachedCandles {
  key: string;
  loadedAt: number;
  candles: GeckoCandle[];
}

export interface GeckoOhlcvOptions {
  poolAddress?: Address;
  network?: string;
  timeframe?: 'minute' | 'hour' | 'day';
  aggregate?: number;
  limit?: number;
  currency?: 'usd' | 'token';
  token?: 'base' | 'quote';
  timeoutMs?: number;
}

let candleCache: CachedCandles | undefined;

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ohlcvList(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return [];
  const attributes = (data as { attributes?: unknown }).attributes;
  if (!attributes || typeof attributes !== 'object') return [];
  const list = (attributes as { ohlcv_list?: unknown }).ohlcv_list;
  return Array.isArray(list) ? list : [];
}

export function normalizeGeckoOhlcv(payload: unknown): GeckoCandle[] {
  const candles = ohlcvList(payload)
    .map((row) => {
      if (!Array.isArray(row) || row.length < 5) return undefined;
      const [timestamp, open, high, low, close, volume = 0] = row.map(finiteNumber);
      if (
        timestamp === undefined ||
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined ||
        volume === undefined
      ) {
        return undefined;
      }

      return { time: Math.trunc(timestamp), open, high, low, close, volume };
    })
    .filter((candle): candle is GeckoCandle => Boolean(candle))
    .sort((a, b) => a.time - b.time);

  const seen = new Set<number>();
  return candles.filter((candle) => {
    if (seen.has(candle.time)) return false;
    seen.add(candle.time);
    return true;
  });
}

function buildOhlcvUrl(options: Required<Omit<GeckoOhlcvOptions, 'timeoutMs'>>): string {
  const url = new URL(`${GECKO_API_BASE}/networks/${options.network}/pools/${options.poolAddress}/ohlcv/${options.timeframe}`);
  url.searchParams.set('aggregate', String(options.aggregate));
  url.searchParams.set('limit', String(options.limit));
  url.searchParams.set('currency', options.currency);
  url.searchParams.set('token', options.token);
  return url.toString();
}

export async function fetchGeckoPoolOhlcv(options: GeckoOhlcvOptions = {}): Promise<GeckoCandle[]> {
  const params = {
    poolAddress: options.poolAddress ?? CONTRACTS.pool,
    network: options.network ?? GECKO_NETWORK,
    timeframe: options.timeframe ?? 'minute',
    aggregate: options.aggregate ?? 15,
    limit: options.limit ?? 96,
    currency: options.currency ?? 'usd',
    token: options.token ?? 'base',
  } satisfies Required<Omit<GeckoOhlcvOptions, 'timeoutMs'>>;

  const url = buildOhlcvUrl(params);
  const now = Date.now();
  if (candleCache?.key === url && now - candleCache.loadedAt < CANDLE_CACHE_MS) {
    return candleCache.candles;
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GeckoTerminal OHLCV request failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    const candles = normalizeGeckoOhlcv(payload);
    if (candles.length === 0) {
      throw new Error('GeckoTerminal returned no usable OHLCV candles');
    }
    candleCache = { key: url, loadedAt: now, candles };
    return candles;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
