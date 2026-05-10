import './styles.css';

import {
  compactAddress,
  estimatedFeeAprPct,
  formatTokenAmount,
  formatUsd,
  percentFormat,
  profitabilityIndex,
  rangeStatus,
  tickLabel,
  tickToAdjustedPrice,
} from './aero-math';
import { HISTORICAL_HOURLY_CANDLE_LIMIT, realizedVolatilityPct } from './analytics';
import { COMPARISON_WALLET_ADDRESS, CONTRACTS, WALLET_ADDRESS } from './config';
import { DASHBOARD_SECTION_ORDER, type DashboardSectionId } from './dashboard-layout';
import { renderBottomAnalytics } from './bottom-analytics';
import { fetchGeckoPoolOhlcv, type GeckoCandle } from './gecko';
import { renderLpRangeChart } from './lp-range-chart';
import { positionValuation, walletUsdValue } from './position-valuation';
import { loadDashboardSnapshot, type DashboardSnapshot, type LivePosition, type TrackedWalletSnapshot } from './rpc';

const REFRESH_MS = 15_000;
const UPTIME_STORAGE_KEY = 'clawberto-range-uptime-v1';
const app = document.querySelector<HTMLDivElement>('#app') ?? failMissingRoot();
type WalletRangeState = 'inRange' | 'outOfRange' | 'noPosition';

interface WalletUptimeStats {
  lastSeenMs: number;
  lastState: WalletRangeState;
  inRangeMs: number;
  outOfRangeMs: number;
  noPositionMs: number;
}

const walletUptimeStats = loadPersistedUptime();

function failMissingRoot(): never {
  throw new Error('Missing #app root');
}

let refreshTimer: number | undefined;

function isWalletRangeState(value: unknown): value is WalletRangeState {
  return value === 'inRange' || value === 'outOfRange' || value === 'noPosition';
}

function loadPersistedUptime(): Map<string, WalletUptimeStats> {
  try {
    const raw = window.localStorage.getItem(UPTIME_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Partial<WalletUptimeStats>>;
    const entries: Array<[string, WalletUptimeStats]> = Object.entries(parsed).flatMap(([key, value]) => {
      const lastSeenMs = value?.lastSeenMs;
      const inRangeMs = value?.inRangeMs;
      const outOfRangeMs = value?.outOfRangeMs;
      const noPositionMs = value?.noPositionMs;
      const lastState = value?.lastState;
      if (
        typeof lastSeenMs !== 'number' ||
        !Number.isFinite(lastSeenMs) ||
        !isWalletRangeState(lastState) ||
        typeof inRangeMs !== 'number' ||
        !Number.isFinite(inRangeMs) ||
        typeof outOfRangeMs !== 'number' ||
        !Number.isFinite(outOfRangeMs) ||
        typeof noPositionMs !== 'number' ||
        !Number.isFinite(noPositionMs)
      ) {
        return [];
      }
      return [[key, {
        lastSeenMs,
        lastState,
        inRangeMs: Math.max(0, inRangeMs),
        outOfRangeMs: Math.max(0, outOfRangeMs),
        noPositionMs: Math.max(0, noPositionMs),
      }]];
    });
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function persistUptime(): void {
  try {
    window.localStorage.setItem(UPTIME_STORAGE_KEY, JSON.stringify(Object.fromEntries(walletUptimeStats)));
  } catch {
    // localStorage can be unavailable in restrictive browser contexts; the in-memory counters still work.
  }
}

function addressLink(address: string): string {
  return `https://basescan.org/address/${address}`;
}

function stateClass(state: string): string {
  return state.toLowerCase().replaceAll('_', '-');
}

function compactNumber(value: bigint | number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a';
  const numeric = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return 'n/a';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(numeric);
}

function scoreFormat(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return value.toFixed(1);
}

function durationFormat(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function renderShell(content: string): void {
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Base / Aerodrome Slipstream / CL200</p>
          <h1>Clawberto LP Console</h1>
        </div>
        <nav class="toplinks" aria-label="Protocol links">
          <a href="${addressLink(CONTRACTS.pool)}" target="_blank" rel="noreferrer">Pool</a>
          <a href="${addressLink(CONTRACTS.gauge)}" target="_blank" rel="noreferrer">Gauge</a>
          <a href="${addressLink(WALLET_ADDRESS)}" target="_blank" rel="noreferrer">AI wallet</a>
          <a href="${addressLink(COMPARISON_WALLET_ADDRESS)}" target="_blank" rel="noreferrer">Human wallet</a>
          <span><i></i> ${REFRESH_MS / 1000}s live</span>
        </nav>
      </header>
      ${content}
    </main>
  `;
}

function renderLoading(): void {
  renderShell(`
    <section class="panel loading-panel">
      <div class="loader"></div>
      <div>
        <h2>Loading LP range state</h2>
        <p>Reading pool tick, NFT ranges, gauge custody, pending AERO, and wallet balances.</p>
      </div>
    </section>
  `);
}

function renderError(error: unknown): void {
  renderShell(`
    <section class="panel error-panel">
      <h2>RPC read failed</h2>
      <p>${error instanceof Error ? error.message : String(error)}</p>
      <button id="retry">Retry now</button>
    </section>
  `);
  document.querySelector('#retry')?.addEventListener('click', () => void refresh());
}

function trackedWalletPositions(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot) {
  const walletAddress = wallet.address.toLowerCase();
  return snapshot.positions.filter((position) =>
    !position.liveError &&
    (position.depositor?.toLowerCase() === walletAddress || position.owner?.toLowerCase() === walletAddress),
  );
}

function weightedAverage(items: Array<{ value?: number; weight?: number }>): number | undefined {
  const usable = items.filter((item) =>
    item.value !== undefined &&
    item.weight !== undefined &&
    Number.isFinite(item.value) &&
    Number.isFinite(item.weight) &&
    item.weight > 0,
  ) as Array<{ value: number; weight: number }>;
  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return undefined;
  return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function poolFeePct(snapshot: DashboardSnapshot): number {
  return snapshot.pool.fee / 1_000_000;
}

function walletChartId(wallet: TrackedWalletSnapshot, index: number): string {
  return `lp-price-chart-${wallet.role.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || index}`;
}

function positionCustodyLabel(position: LivePosition, wallet?: TrackedWalletSnapshot): string {
  if (position.staked) return 'gauge-staked';
  if (wallet && position.owner?.toLowerCase() === wallet.address.toLowerCase()) return 'wallet-held';
  if (position.owner) return 'external custody';
  return 'custody unknown';
}

function custodySummary(positions: LivePosition[], wallet: TrackedWalletSnapshot): string {
  if (positions.length === 0) return 'no active LP';
  const staked = positions.filter((position) => position.staked).length;
  const walletHeld = positions.filter((position) => !position.staked && position.owner?.toLowerCase() === wallet.address.toLowerCase()).length;
  const external = positions.length - staked - walletHeld;
  return [
    staked > 0 ? `${staked} staked` : '',
    walletHeld > 0 ? `${walletHeld} wallet-held` : '',
    external > 0 ? `${external} external` : '',
  ].filter(Boolean).join(' / ');
}

function aprBreakdown(summary: { feeAprPct?: number; emissionAprPct?: number }, positions: LivePosition[]): string {
  if (positions.length === 0) return 'no active LP';
  const fee = summary.feeAprPct === undefined ? 'fees n/a' : `fees ${percentFormat(summary.feeAprPct, 2)}`;
  const emissions = summary.emissionAprPct === undefined ? 'emissions n/a' : `emissions ${percentFormat(summary.emissionAprPct, 2)}`;
  return `${fee} / ${emissions}`;
}

function walletLpSummary(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot, volatilityPct: number) {
  const positions = trackedWalletPositions(snapshot, wallet)
    .filter((position) => position.liquidity !== undefined && position.liquidity > 0n);
  const valuations = positions.map((position) => ({
    position,
    valuation: positionValuation(position, snapshot),
    status: position.tickLower !== undefined && position.tickUpper !== undefined
      ? rangeStatus(snapshot.pool.currentTick, position.tickLower, position.tickUpper)
      : undefined,
  }));
  const lpUsd = valuations.reduce((sum, item) => sum + (item.valuation.usd?.totalUsd ?? 0), 0);
  const pendingAero = positions.reduce((sum, position) => sum + (position.earnedAero ?? 0n), 0n);
  const pendingAeroUsd = valuations.reduce((sum, item) => sum + (item.valuation.pendingAeroUsd ?? 0), 0);
  const token0Usd = valuations.reduce((sum, item) => sum + (item.valuation.usd?.token0Usd ?? 0), 0);
  const token1Usd = valuations.reduce((sum, item) => sum + (item.valuation.usd?.token1Usd ?? 0), 0);
  const emissionApr = weightedAverage(valuations.map((item) => ({
    value: item.valuation.aprPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const inRange = valuations.some((item) => item.status?.state === 'IN_RANGE');
  const feeApr = positions.length > 0
    ? inRange
      ? estimatedFeeAprPct(snapshot.market.managedPair?.volume?.h24, poolFeePct(snapshot), snapshot.market.managedPair?.liquidityUsd) ?? 0
      : 0
    : undefined;
  const holdVsLp = weightedAverage(valuations.map((item) => ({
    value: item.valuation.holdVsLpPct ?? item.valuation.fullRangeIlPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const outOfRange = valuations.some((item) => item.status && item.status.state !== 'IN_RANGE');
  const rangeState: WalletRangeState = positions.length === 0
    ? 'noPosition'
    : outOfRange ? 'outOfRange' : 'inRange';
  const lowerHeadroomPct = weightedAverage(valuations.map((item) => ({
    value: item.status?.lowerHeadroomPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const upperHeadroomPct = weightedAverage(valuations.map((item) => ({
    value: item.status?.upperHeadroomPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const primary = valuations[0];
  const index = profitabilityIndex({
    emissionAprPct: emissionApr,
    feeAprPct: feeApr,
    volatilityPct,
    impermanentLossPct: holdVsLp,
    pendingRewardsUsd: pendingAeroUsd,
    portfolioUsd: lpUsd,
    outOfRange,
  });

  return {
    positions,
    lpUsd,
    pendingAero,
    pendingAeroUsd,
    emissionAprPct: emissionApr,
    feeAprPct: feeApr,
    aprPct: emissionApr !== undefined || feeApr !== undefined ? (emissionApr ?? 0) + (feeApr ?? 0) : undefined,
    index,
    rangeState,
    status: primary?.status,
    lfiSidePct: lpUsd > 0 ? (token0Usd / lpUsd) * 100 : undefined,
    usdcSidePct: lpUsd > 0 ? (token1Usd / lpUsd) * 100 : undefined,
    lowerHeadroomPct,
    upperHeadroomPct,
  };
}

function updateWalletUptime(wallet: TrackedWalletSnapshot, state: WalletRangeState, nowMs: number): WalletUptimeStats {
  const key = wallet.address.toLowerCase();
  const current = walletUptimeStats.get(key) ?? {
    lastSeenMs: nowMs,
    lastState: state,
    inRangeMs: 0,
    outOfRangeMs: 0,
    noPositionMs: 0,
  };
  const elapsedMs = Math.max(0, Math.min(REFRESH_MS * 2, nowMs - current.lastSeenMs));
  if (elapsedMs > 0) {
    if (current.lastState === 'inRange') current.inRangeMs += elapsedMs;
    if (current.lastState === 'outOfRange') current.outOfRangeMs += elapsedMs;
    if (current.lastState === 'noPosition') current.noPositionMs += elapsedMs;
  }
  current.lastSeenMs = nowMs;
  current.lastState = state;
  walletUptimeStats.set(key, current);
  persistUptime();
  return current;
}

function renderUptime(stats: WalletUptimeStats, state: WalletRangeState): string {
  const total = stats.inRangeMs + stats.outOfRangeMs + stats.noPositionMs;
  const inPct = total > 0 ? (stats.inRangeMs / total) * 100 : state === 'inRange' ? 100 : 0;
  const outPct = total > 0 ? (stats.outOfRangeMs / total) * 100 : state === 'outOfRange' ? 100 : 0;
  const nonePct = total > 0 ? (stats.noPositionMs / total) * 100 : state === 'noPosition' ? 100 : 0;
  const label = state === 'inRange' ? 'in range' : state === 'outOfRange' ? 'out of range' : 'no active LP';
  return `
    <div class="uptime-card">
      <div class="uptime-head">
        <span>Range uptime</span>
        <strong>${percentFormat(inPct, 1)}</strong>
      </div>
      <div class="uptime-bar" aria-label="Range uptime split">
        <i class="uptime-in" style="width: ${inPct}%"></i>
        <i class="uptime-out" style="width: ${outPct}%"></i>
        <i class="uptime-none" style="width: ${nonePct}%"></i>
      </div>
      <div class="uptime-legend">
        <span><b class="uptime-in"></b>${durationFormat(stats.inRangeMs)} in</span>
        <span><b class="uptime-out"></b>${durationFormat(stats.outOfRangeMs)} out</span>
        <span><b class="uptime-none"></b>${durationFormat(stats.noPositionMs)} none</span>
      </div>
      <small>Current: ${label}</small>
    </div>
  `;
}

function renderWalletLpPanel(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot, index: number, volatilityPct: number): string {
  const walletUsd = walletUsdValue(snapshot, wallet.balances);
  const summary = walletLpSummary(snapshot, wallet, volatilityPct);
  const uptime = updateWalletUptime(wallet, summary.rangeState, snapshot.loadedAt.getTime());
  const status = summary.status?.state ?? (summary.positions.length > 0 ? 'READABLE' : 'NO_ACTIVE_LP');
  const sideSplit = summary.lfiSidePct === undefined || summary.usdcSidePct === undefined
    ? 'n/a'
    : `${percentFormat(summary.lfiSidePct, 0)} / ${percentFormat(summary.usdcSidePct, 0)}`;
  const rangeHeadroom = summary.lowerHeadroomPct === undefined || summary.upperHeadroomPct === undefined
    ? 'range n/a'
    : `${percentFormat(summary.lowerHeadroomPct, 0)} lower / ${percentFormat(summary.upperHeadroomPct, 0)} upper`;
  return `
    <article class="wallet-lp-panel">
      <header class="wallet-lp-header">
        <div>
          <p class="eyebrow">${wallet.role === 'agent' ? 'AI agent' : 'Manual human'}</p>
          <h2>${wallet.shortLabel}</h2>
          <a href="${addressLink(wallet.address)}" target="_blank" rel="noreferrer">${compactAddress(wallet.address)}</a>
        </div>
        <span class="status ${summary.status ? stateClass(summary.status.state) : 'no-active-lp'}">${status.replaceAll('_', ' ')}</span>
      </header>
      <div class="wallet-kpi-grid">
        <div><span>Profitability</span><strong>${scoreFormat(summary.index)}</strong><small>history-based index</small></div>
        <div><span>Active LP</span><strong>${formatUsd(summary.lpUsd)}</strong><small>${summary.positions.length} NFT${summary.positions.length === 1 ? '' : 's'} / ${custodySummary(summary.positions, wallet)}</small></div>
        <div><span>APR</span><strong>${summary.aprPct === undefined ? 'n/a' : percentFormat(summary.aprPct, 2)}</strong><small>${aprBreakdown(summary, summary.positions)}</small></div>
        <div><span>Pending</span><strong>${formatTokenAmount(summary.pendingAero, 18, 4)} AERO</strong><small>${summary.positions.length === 0 ? 'no active LP' : summary.positions.some((position) => position.staked) ? formatUsd(summary.pendingAeroUsd) : 'not gauge-staked'}</small></div>
        <div><span>LP split</span><strong>${sideSplit}</strong><small>${rangeHeadroom}</small></div>
        <div><span>Wallet</span><strong>${formatUsd(walletUsd)}</strong><small>${formatTokenAmount(wallet.balances.lfi, 18, 2)} LFI</small></div>
      </div>
      ${renderUptime(uptime, summary.rangeState)}
      <div id="${walletChartId(wallet, index)}" class="lp-price-chart wallet-chart" aria-live="polite"></div>
    </article>
  `;
}

function renderRangeConsole(snapshot: DashboardSnapshot, historicalCandles: GeckoCandle[]): string {
  const price = tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
  const volatilityPct = realizedVolatilityPct(historicalCandles, 24);
  const readablePositions = snapshot.positions.filter((position) => !position.liveError && position.tickLower !== undefined && position.tickUpper !== undefined);

  return `
    <section class="range-console" data-section="range-control">
      <div class="console-head">
        <div>
          <p class="eyebrow">Manual human vs AI agent</p>
          <h2>LFI/USDC LP cockpit</h2>
          <p>Current price <b>${formatUsd(price, 8)}</b> per LFI / tick <b>${tickLabel(snapshot.pool.currentTick)}</b></p>
        </div>
        <div class="head-metrics">
          <span>${readablePositions.length} readable / ${snapshot.positions.length} tracked</span>
          <span>updated ${snapshot.loadedAt.toLocaleTimeString()}</span>
        </div>
      </div>
      <div class="wallet-compare-grid">
        ${snapshot.trackedWallets.map((wallet, index) => renderWalletLpPanel(snapshot, wallet, index, volatilityPct)).join('')}
      </div>
    </section>
  `;
}

function renderDiagnostics(snapshot: DashboardSnapshot): string {
  const stakedRatio = snapshot.pool.liquidity > 0n ? (Number(snapshot.pool.stakedLiquidity) / Number(snapshot.pool.liquidity)) * 100 : 0;
  const positionRows = snapshot.positions.map((position) => {
    const wallet = snapshot.trackedWallets.find((item) =>
      item.address.toLowerCase() === position.depositor?.toLowerCase() ||
      item.address.toLowerCase() === position.owner?.toLowerCase(),
    );
    const status = position.tickLower !== undefined && position.tickUpper !== undefined
      ? rangeStatus(snapshot.pool.currentTick, position.tickLower, position.tickUpper).state.replaceAll('_', ' ')
      : 'range unknown';
    const range = position.tickLower !== undefined && position.tickUpper !== undefined
      ? `${tickLabel(position.tickLower)} to ${tickLabel(position.tickUpper)}`
      : 'range unknown';
    return `
          <div class="timeline-row">
            <span>NFT #${position.tokenId.toString()}</span>
            <div>
              <strong>${wallet?.shortLabel ?? 'Tracked wallet'} / ${positionCustodyLabel(position, wallet)}</strong>
              <p>${status} / ${range} / liquidity ${compactNumber(position.liquidity)}</p>
            </div>
          </div>
        `;
  }).join('');
  const walletRows = snapshot.trackedWallets.map((wallet) => `
          <div class="timeline-row">
            <span>${wallet.shortLabel}</span>
            <div>
              <strong>${compactAddress(wallet.address)}</strong>
              <p>${formatTokenAmount(wallet.balances.lfi, 18, 2)} LFI / ${formatTokenAmount(wallet.balances.usdc, 6, 2)} USDC / ${formatTokenAmount(wallet.balances.aero, 18, 4)} AERO</p>
            </div>
          </div>
        `).join('');
  return `
    <details class="panel history-panel diagnostics-panel" data-section="diagnostics-secondary">
      <summary>
        <span><b>Diagnostics</b><em>Pool liquidity ${compactNumber(snapshot.pool.liquidity)} / staked ${percentFormat(stakedRatio, 1)} / ${snapshot.positions.length} verified LFI/USDC LP${snapshot.positions.length === 1 ? '' : 's'}</em></span>
        <strong>Open details</strong>
      </summary>
      <div class="timeline">
        <div class="timeline-row">
          <span>Discovery</span>
          <div>
            <strong>${snapshot.positionDiscovery.source}</strong>
            <p>${snapshot.positionDiscovery.walletNftsScanned} wallet NFTs scanned / ${snapshot.positionDiscovery.gaugeLogsScanned} gauge logs checked / ${snapshot.positionDiscovery.gaugeNftsScanned} gauge NFTs sampled / ${snapshot.positionDiscovery.discoveredRecords} tracked candidates${snapshot.positionDiscovery.error ? ` / ${snapshot.positionDiscovery.error}` : ''}</p>
          </div>
        </div>
        <div class="timeline-row">
          <span>Pool</span>
          <div>
            <strong>Gauge emissions and custody</strong>
            <p>${formatTokenAmount(snapshot.pool.rewardsLeft, 18, 2)} AERO left / ${percentFormat(stakedRatio, 1)} staked / fee ${(snapshot.pool.fee / 10_000).toFixed(2)}%</p>
          </div>
        </div>
        ${walletRows}
        ${positionRows}
      </div>
    </details>
  `;
}

function renderAnalyticsPlaceholder(): string {
  return `
    <section class="analytics-panel" data-section="analytics-bottom" id="analytics-bottom" aria-live="polite">
      <div class="analytics-loading">
        <div class="loader small"></div>
        <span>Loading LFI analytics</span>
      </div>
    </section>
  `;
}

function renderDashboard(snapshot: DashboardSnapshot, historicalCandles: GeckoCandle[]): void {
  const sections: Record<DashboardSectionId, string> = {
    'range-control': renderRangeConsole(snapshot, historicalCandles),
    'analytics-bottom': renderAnalyticsPlaceholder(),
    'diagnostics-secondary': renderDiagnostics(snapshot),
  };
  renderShell(DASHBOARD_SECTION_ORDER.map((section) => sections[section]).join(''));
  snapshot.trackedWallets.forEach((wallet, index) => {
    const chartMount = document.querySelector<HTMLElement>(`#${walletChartId(wallet, index)}`);
    if (chartMount) {
      void renderLpRangeChart(snapshot, chartMount, {
        positions: trackedWalletPositions(snapshot, wallet),
        compact: true,
        emptyTitle: `No ${wallet.shortLabel} active LP`,
        emptyDescription: 'Live candles stay visible. A range appears here only when Base RPC attributes a positive-liquidity LFI/USDC NFT to this wallet.',
      });
    }
  });
  const analyticsMount = document.querySelector<HTMLElement>('#analytics-bottom');
  if (analyticsMount) void renderBottomAnalytics(snapshot, analyticsMount, historicalCandles);
}

async function refresh(): Promise<void> {
  window.clearTimeout(refreshTimer);
  try {
    const [snapshot, historicalCandles] = await Promise.all([
      loadDashboardSnapshot(),
      fetchGeckoPoolOhlcv({ poolAddress: CONTRACTS.pool, timeframe: 'hour', aggregate: 1, limit: HISTORICAL_HOURLY_CANDLE_LIMIT }).catch(() => []),
    ]);
    renderDashboard(snapshot, historicalCandles);
  } catch (error) {
    renderError(error);
  } finally {
    refreshTimer = window.setTimeout(() => void refresh(), REFRESH_MS);
  }
}

renderLoading();
void refresh();
