export type WalletRangeState = 'inRange' | 'outOfRange' | 'noPosition';

export interface WalletUptimeStats {
  firstSeenMs: number;
  lastSeenMs: number;
  lastState: WalletRangeState;
  inRangeMs: number;
  outOfRangeMs: number;
  noPositionMs: number;
}

export function isWalletRangeState(value: unknown): value is WalletRangeState {
  return value === 'inRange' || value === 'outOfRange' || value === 'noPosition';
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegative(value: number): number {
  return Math.max(0, value);
}

function addElapsed(stats: WalletUptimeStats, state: WalletRangeState, elapsedMs: number): void {
  const elapsed = nonNegative(elapsedMs);
  if (elapsed === 0) return;
  if (state === 'inRange') stats.inRangeMs += elapsed;
  if (state === 'outOfRange') stats.outOfRangeMs += elapsed;
  if (state === 'noPosition') stats.noPositionMs += elapsed;
}

export function reconcileTrackedSpan(stats: WalletUptimeStats): WalletUptimeStats {
  const totalMs = stats.inRangeMs + stats.outOfRangeMs + stats.noPositionMs;
  const trackedSpanMs = nonNegative(stats.lastSeenMs - stats.firstSeenMs);
  const missingMs = trackedSpanMs - totalMs;
  if (missingMs > 0) addElapsed(stats, stats.lastState, missingMs);
  return stats;
}

export function normalizeWalletUptimeStats(value: Partial<WalletUptimeStats> | undefined): WalletUptimeStats | undefined {
  if (!value || !finiteNumber(value.lastSeenMs) || !isWalletRangeState(value.lastState)) return undefined;
  if (!finiteNumber(value.inRangeMs) || !finiteNumber(value.outOfRangeMs) || !finiteNumber(value.noPositionMs)) return undefined;

  return reconcileTrackedSpan({
    firstSeenMs: finiteNumber(value.firstSeenMs) ? Math.min(value.firstSeenMs, value.lastSeenMs) : value.lastSeenMs,
    lastSeenMs: value.lastSeenMs,
    lastState: value.lastState,
    inRangeMs: nonNegative(value.inRangeMs),
    outOfRangeMs: nonNegative(value.outOfRangeMs),
    noPositionMs: nonNegative(value.noPositionMs),
  });
}

export function updateWalletUptimeStats(current: WalletUptimeStats | undefined, state: WalletRangeState, nowMs: number): WalletUptimeStats {
  const next = current
    ? reconcileTrackedSpan({ ...current })
    : {
      firstSeenMs: nowMs,
      lastSeenMs: nowMs,
      lastState: state,
      inRangeMs: 0,
      outOfRangeMs: 0,
      noPositionMs: 0,
    };

  addElapsed(next, next.lastState, nowMs - next.lastSeenMs);
  next.lastSeenMs = Math.max(next.lastSeenMs, nowMs);
  next.lastState = state;
  return next;
}
