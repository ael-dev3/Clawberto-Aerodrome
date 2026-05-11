export interface WalletPnlRecord {
  walletKey: string;
  positionSetKey: string;
  baselineUsd: number;
  baselineAtMs: number;
  lastSeenMs: number;
  lastTotalUsd: number;
}

export interface WalletPnlInput {
  walletKey: string;
  positionSetKey: string;
  totalUsd: number;
  nowMs: number;
}

export interface WalletPnlSnapshot {
  walletKey: string;
  positionSetKey: string;
  baselineUsd: number;
  currentUsd: number;
  baselineAtMs: number;
  pnlUsd: number;
  pnlPct?: number;
  isNewBaseline: boolean;
}

export interface WalletPnlUpdate {
  record: WalletPnlRecord;
  snapshot: WalletPnlSnapshot;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function activePositionSetKey(tokenIds: ReadonlyArray<bigint | number | string>): string {
  if (tokenIds.length === 0) return 'no-active-lp';
  return tokenIds
    .map((tokenId) => tokenId.toString())
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
    .join(':');
}

export function normalizeWalletPnlRecord(value: Partial<WalletPnlRecord> | undefined): WalletPnlRecord | undefined {
  if (!value || typeof value.walletKey !== 'string' || typeof value.positionSetKey !== 'string') return undefined;
  const walletKey = normalizeKey(value.walletKey);
  if (!walletKey || !value.positionSetKey) return undefined;
  if (!finiteNumber(value.baselineUsd) || !finiteNumber(value.baselineAtMs)) return undefined;
  if (!finiteNumber(value.lastSeenMs) || !finiteNumber(value.lastTotalUsd)) return undefined;
  if (value.baselineUsd < 0 || value.lastTotalUsd < 0) return undefined;

  return {
    walletKey,
    positionSetKey: value.positionSetKey,
    baselineUsd: value.baselineUsd,
    baselineAtMs: value.baselineAtMs,
    lastSeenMs: Math.max(value.baselineAtMs, value.lastSeenMs),
    lastTotalUsd: value.lastTotalUsd,
  };
}

function freshRecord(input: WalletPnlInput): WalletPnlRecord {
  return {
    walletKey: normalizeKey(input.walletKey),
    positionSetKey: input.positionSetKey,
    baselineUsd: Math.max(0, input.totalUsd),
    baselineAtMs: input.nowMs,
    lastSeenMs: input.nowMs,
    lastTotalUsd: Math.max(0, input.totalUsd),
  };
}

export function updateWalletPnlRecord(current: WalletPnlRecord | undefined, input: WalletPnlInput): WalletPnlUpdate {
  const normalizedInput = {
    ...input,
    walletKey: normalizeKey(input.walletKey),
    totalUsd: Math.max(0, input.totalUsd),
  };
  const normalizedCurrent = normalizeWalletPnlRecord(current);
  const resetBaseline = !normalizedCurrent ||
    normalizedCurrent.walletKey !== normalizedInput.walletKey ||
    normalizedCurrent.positionSetKey !== normalizedInput.positionSetKey;
  const record = resetBaseline
    ? freshRecord(normalizedInput)
    : {
      ...normalizedCurrent,
      lastSeenMs: Math.max(normalizedCurrent.lastSeenMs, normalizedInput.nowMs),
      lastTotalUsd: normalizedInput.totalUsd,
    };
  const pnlUsd = normalizedInput.totalUsd - record.baselineUsd;
  return {
    record,
    snapshot: {
      walletKey: record.walletKey,
      positionSetKey: record.positionSetKey,
      baselineUsd: record.baselineUsd,
      currentUsd: normalizedInput.totalUsd,
      baselineAtMs: record.baselineAtMs,
      pnlUsd,
      pnlPct: record.baselineUsd > 0 ? (pnlUsd / record.baselineUsd) * 100 : undefined,
      isNewBaseline: resetBaseline,
    },
  };
}
