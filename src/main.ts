import './styles.css';

import {
  compactAddress,
  estimatedFeeAprPct,
  formatTokenAmount,
  formatUsd,
  percentFormat,
  profitabilityIndex,
  rangeStatus,
  rawToDecimal,
  tickLabel,
  tickToAdjustedPrice,
} from './aero-math';
import { HISTORICAL_HOURLY_CANDLE_LIMIT, realizedVolatilityPct } from './analytics';
import { COMPARISON_WALLET_ADDRESS, CONTRACTS, WALLET_ADDRESS } from './config';
import { DASHBOARD_SECTION_ORDER, type DashboardSectionId } from './dashboard-layout';
import { renderBottomAnalytics } from './bottom-analytics';
import { fetchGeckoPoolOhlcv, type GeckoCandle } from './gecko';
import { renderLpRangeChart } from './lp-range-chart';
import { poolReserveBreakdown, positionValuation, tokenSymbol, walletUsdValue } from './position-valuation';
import { loadDashboardSnapshot, trackedPositionAddresses, type DashboardSnapshot, type LivePosition, type TrackedWalletSnapshot } from './rpc';

const REFRESH_MS = 15_000;
const UPTIME_STORAGE_KEY = 'clawberto-range-uptime-v1';
const app = document.querySelector<HTMLDivElement>('#app') ?? failMissingRoot();
type WalletRangeState = 'inRange' | 'outOfRange' | 'noPosition';

interface WalletUptimeStats {
  firstSeenMs: number;
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
let tooltipNode: HTMLDivElement | undefined;

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
      const firstSeenMs = value?.firstSeenMs;
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
        firstSeenMs: typeof firstSeenMs === 'number' && Number.isFinite(firstSeenMs) ? firstSeenMs : lastSeenMs,
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

function getTooltipNode(): HTMLDivElement {
  if (tooltipNode) return tooltipNode;
  const node = document.createElement('div');
  node.className = 'app-tooltip';
  node.setAttribute('role', 'tooltip');
  document.body.appendChild(node);
  tooltipNode = node;
  return node;
}

function positionTooltip(clientX: number, clientY: number): void {
  if (!tooltipNode) return;
  const margin = 12;
  const bounds = tooltipNode.getBoundingClientRect();
  const x = Math.min(window.innerWidth - bounds.width - 8, Math.max(8, clientX + margin));
  const preferredTop = clientY - bounds.height - margin;
  const y = preferredTop >= 8
    ? preferredTop
    : Math.min(window.innerHeight - bounds.height - 8, clientY + margin);
  tooltipNode.style.left = `${x}px`;
  tooltipNode.style.top = `${y}px`;
}

function showTooltip(target: HTMLElement, clientX: number, clientY: number): void {
  const text = target.dataset.tooltip;
  if (!text) return;
  const node = getTooltipNode();
  node.textContent = text;
  node.classList.add('is-visible');
  positionTooltip(clientX, clientY);
}

function hideTooltip(): void {
  tooltipNode?.classList.remove('is-visible');
}

function installTooltips(): void {
  document.addEventListener('pointerover', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tooltip]');
    if (!target) return;
    showTooltip(target, event.clientX, event.clientY);
  });
  document.addEventListener('pointermove', (event) => {
    if (tooltipNode?.classList.contains('is-visible')) positionTooltip(event.clientX, event.clientY);
  });
  document.addEventListener('pointerout', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tooltip]');
    if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
    hideTooltip();
  });
  document.addEventListener('focusin', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tooltip]');
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    showTooltip(target, bounds.left + bounds.width / 2, bounds.top);
  });
  document.addEventListener('focusout', hideTooltip);
}

function addressLink(address: string): string {
  return `https://basescan.org/address/${address}`;
}

function stateClass(state: string): string {
  if (state === 'IN_RANGE') return 'in-range';
  if (state === 'NO_ACTIVE_LP') return 'no-active-lp';
  if (state === 'READABLE') return 'readable';
  return 'out-of-range';
}

function statusLabel(state: string | undefined): string {
  if (state === undefined) return 'READABLE';
  if (state === 'IN_RANGE') return 'IN RANGE';
  if (state === 'NO_ACTIVE_LP') return 'NO ACTIVE LP';
  if (state === 'READABLE') return 'READABLE';
  return 'OUT OF RANGE';
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
  const walletAddresses = new Set(trackedPositionAddresses(wallet).map((address) => address.toLowerCase()));
  return snapshot.positions.filter((position) =>
    !position.liveError &&
    (
      (position.depositor !== undefined && walletAddresses.has(position.depositor.toLowerCase())) ||
      (position.owner !== undefined && walletAddresses.has(position.owner.toLowerCase()))
    ),
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
  const addresses = wallet ? new Set(trackedPositionAddresses(wallet).map((address) => address.toLowerCase())) : new Set<string>();
  if (position.owner && addresses.has(position.owner.toLowerCase())) return 'wallet-held';
  if (position.owner) return 'external custody';
  return 'custody unknown';
}

function custodySummary(positions: LivePosition[], wallet: TrackedWalletSnapshot): string {
  if (positions.length === 0) return 'no active LP';
  const addresses = new Set(trackedPositionAddresses(wallet).map((address) => address.toLowerCase()));
  const staked = positions.filter((position) => position.staked).length;
  const walletHeld = positions.filter((position) => !position.staked && position.owner && addresses.has(position.owner.toLowerCase())).length;
  const external = positions.length - staked - walletHeld;
  return [
    staked > 0 ? `${staked} staked` : '',
    walletHeld > 0 ? `${walletHeld} wallet-held` : '',
    external > 0 ? `${external} external` : '',
  ].filter(Boolean).join(' / ');
}

function aprBreakdown(summary: { feeAprPct?: number; emissionAprPct?: number }, positions: LivePosition[]): string {
  if (positions.length === 0) return 'no active LP';
  const emissions = summary.emissionAprPct === undefined ? 'rewards n/a' : `rewards ${percentFormat(summary.emissionAprPct, 2)}`;
  const fee = summary.feeAprPct === undefined ? 'fee est n/a' : `fee est ${percentFormat(summary.feeAprPct, 2)}`;
  return `${emissions} / ${fee}`;
}

function numberFormat(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function tokenAmountFormat(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value >= 1_000 ? 5 : 6,
  }).format(value);
}

function liquiditySharePct(positionLiquidity: bigint | undefined, totalLiquidity: bigint): number | undefined {
  if (positionLiquidity === undefined || totalLiquidity <= 0n) return undefined;
  return (Number(positionLiquidity) / Number(totalLiquidity)) * 100;
}

function livePoolTvlUsd(snapshot: DashboardSnapshot): number | undefined {
  const reserveTvl = poolReserveBreakdown(snapshot).totalUsd;
  if (Number.isFinite(reserveTvl) && reserveTvl > 0) return reserveTvl;
  return snapshot.market.managedPair?.liquidityUsd;
}

function rewardAeroPerDay(position: LivePosition, snapshot: DashboardSnapshot): number | undefined {
  if (!position.staked || position.liquidity === undefined || snapshot.pool.stakedLiquidity <= 0n) return undefined;
  const rewardPerSecond = rawToDecimal(snapshot.pool.rewardRate, 18);
  return rewardPerSecond * 86_400 * (Number(position.liquidity) / Number(snapshot.pool.stakedLiquidity));
}

function stakedTvlUsd(snapshot: DashboardSnapshot): number | undefined {
  const poolTvl = livePoolTvlUsd(snapshot);
  if (poolTvl === undefined || snapshot.pool.liquidity <= 0n) return undefined;
  return poolTvl * (Number(snapshot.pool.stakedLiquidity) / Number(snapshot.pool.liquidity));
}

function walletLinkList(wallet: TrackedWalletSnapshot): string {
  const addresses = trackedPositionAddresses(wallet);
  const controllers = addresses.slice(1);
  const empty = controllers.length === 0;
  return `
    <div class="wallet-controller-list${empty ? ' is-empty' : ''}"${empty ? ' aria-hidden="true"' : ''}>
      <span>LP controllers</span>
      ${empty
        ? ''
        : controllers.map((address) => `<a href="${addressLink(address)}" target="_blank" rel="noreferrer">${compactAddress(address)}</a>`).join('')}
    </div>
  `;
}

function renderPositionParameters(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot, positions: LivePosition[]): string {
  if (positions.length === 0) return '';
  const poolTvl = livePoolTvlUsd(snapshot);
  const stakedTvl = stakedTvlUsd(snapshot);
  const poolFee = `${(snapshot.pool.fee / 10_000).toFixed(2)}%`;
  const weeklyRewardsAero = rawToDecimal(snapshot.pool.rewardRate, 18) * 604_800;
  const weeklyRewardsUsd = snapshot.market.aeroUsd ? weeklyRewardsAero * snapshot.market.aeroUsd : undefined;

  return `
    <div class="position-parameter-list">
      ${positions.map((position) => {
        const valuation = positionValuation(position, snapshot);
        const status = position.tickLower !== undefined && position.tickUpper !== undefined
          ? rangeStatus(snapshot.pool.currentTick, position.tickLower, position.tickUpper)
          : undefined;
        const feeApr = status?.state === 'IN_RANGE'
          ? estimatedFeeAprPct(snapshot.market.managedPair?.volume?.h24, poolFeePct(snapshot), snapshot.market.managedPair?.liquidityUsd) ?? 0
          : 0;
        const emissionApr = valuation.aprPct;
        const displayApr = emissionApr ?? 0;
        const dailyAero = rewardAeroPerDay(position, snapshot);
        const dailyRewardsUsd = dailyAero !== undefined && snapshot.market.aeroUsd ? dailyAero * snapshot.market.aeroUsd : undefined;
        const earnedAero = position.earnedAero === undefined ? undefined : rawToDecimal(position.earnedAero, 18);
        const earnedUsd = valuation.pendingAeroUsd;
        const token0 = tokenSymbol(position.token0, 'token0');
        const token1 = tokenSymbol(position.token1, 'token1');
        const poolShare = valuation.usd?.totalUsd !== undefined && poolTvl !== undefined && poolTvl > 0
          ? (valuation.usd.totalUsd / poolTvl) * 100
          : liquiditySharePct(position.liquidity, snapshot.pool.liquidity);
        const rewardShare = position.staked ? liquiditySharePct(position.liquidity, snapshot.pool.stakedLiquidity) : undefined;
        const rangeLabel = position.tickLower !== undefined && position.tickUpper !== undefined
          ? `${tickLabel(position.tickLower)} to ${tickLabel(position.tickUpper)}`
          : 'n/a';

        return `
          <section class="position-parameter-card">
            <header>
              <div>
                <span>${positionCustodyLabel(position, wallet)}</span>
                <strong>NFT #${position.tokenId.toString()}</strong>
              </div>
              <b class="status ${status ? stateClass(status.state) : 'no-active-lp'}">${statusLabel(status?.state)}</b>
            </header>
            <div class="position-parameter-grid">
              <div><span>Deposit value</span><strong>${formatUsd(valuation.usd?.totalUsd)}</strong><small>${tokenAmountFormat(valuation.amounts?.token0)} ${token0} / ${tokenAmountFormat(valuation.amounts?.token1)} ${token1}</small></div>
              <div><span>Daily rewards</span><strong>${dailyRewardsUsd === undefined ? 'n/a' : formatUsd(dailyRewardsUsd)}</strong><small>${dailyAero === undefined ? 'not staked' : `${numberFormat(dailyAero, 4)} AERO/day`}</small></div>
              <div><span>Earned</span><strong>${earnedUsd === undefined ? 'n/a' : formatUsd(earnedUsd)}</strong><small>${earnedAero === undefined ? 'read pending' : `${numberFormat(earnedAero, 4)} AERO`}</small></div>
              <div><span>APR</span><strong>${percentFormat(displayApr, 2)}</strong><small>rewards ${emissionApr === undefined ? 'n/a' : percentFormat(emissionApr, 2)} / fee est ${percentFormat(feeApr, 2)}</small></div>
              <div><span>Deposits share</span><strong>${poolShare === undefined ? 'n/a' : percentFormat(poolShare, 2)}</strong><small>reward share ${rewardShare === undefined ? 'n/a' : percentFormat(rewardShare, 2)}</small></div>
              <div><span>Range</span><strong>${rangeLabel}</strong><small>${status ? `${percentFormat(status.lowerHeadroomPct, 0)} lower / ${percentFormat(status.upperHeadroomPct, 0)} upper` : 'n/a'}</small></div>
              <div><span>Farm</span><strong>${position.staked ? 'Rewarded' : 'Unstaked'}</strong><small>earned via ${compactAddress(position.depositor ?? wallet.address)}</small></div>
              <div><span>Cover</span><strong>Uncovered</strong><small>no hedge contract detected</small></div>
            </div>
            <div class="position-parameter-kv">
              <span>Pool TVL <b>${poolTvl === undefined ? 'n/a' : formatUsd(poolTvl)}</b></span>
              <span>Staked TVL <b>${stakedTvl === undefined ? 'n/a' : formatUsd(stakedTvl)}</b></span>
              <span>Weekly rewards <b>${weeklyRewardsUsd === undefined ? 'n/a' : formatUsd(weeklyRewardsUsd)} / ${numberFormat(weeklyRewardsAero, 2)} AERO</b></span>
              <span>Pool fee <b>${poolFee}</b></span>
              <span>NFT manager <b>${compactAddress(CONTRACTS.nftManager)}</b></span>
              <span>Farm contract <b>${compactAddress(CONTRACTS.gauge)}</b></span>
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
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
    aprPct: emissionApr,
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
    firstSeenMs: nowMs,
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
  const unavailableMs = stats.outOfRangeMs + stats.noPositionMs;
  const total = stats.inRangeMs + unavailableMs;
  const inPct = total > 0 ? (stats.inRangeMs / total) * 100 : state === 'inRange' ? 100 : 0;
  const unavailablePct = total > 0 ? (unavailableMs / total) * 100 : state === 'inRange' ? 0 : 100;
  const label = state === 'inRange' ? 'in range' : state === 'outOfRange' ? 'out of range' : 'no active LP';
  const trackingSince = new Date(stats.firstSeenMs).toLocaleString();
  return `
    <div class="uptime-card">
      <div class="uptime-head">
        <span>Range uptime</span>
        <strong>${percentFormat(inPct, 1)}</strong>
      </div>
      <div class="uptime-bar" aria-label="Range uptime split">
        <i class="uptime-in" style="width: ${inPct}%"></i>
        <i class="uptime-out" style="width: ${unavailablePct}%"></i>
      </div>
      <div class="uptime-legend">
        <span><b class="uptime-in"></b>${durationFormat(stats.inRangeMs)} in</span>
        <span><b class="uptime-out"></b>${durationFormat(unavailableMs)} out/no position</span>
      </div>
      <small>Current: ${label} / tracking since ${trackingSince}</small>
    </div>
  `;
}

function renderWalletLpPanel(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot, index: number, volatilityPct: number): string {
  const walletUsd = walletUsdValue(snapshot, wallet.balances);
  const summary = walletLpSummary(snapshot, wallet, volatilityPct);
  const totalTrackedUsd = walletUsd + summary.lpUsd;
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
          ${walletLinkList(wallet)}
        </div>
        <span class="status ${stateClass(status)}">${statusLabel(status)}</span>
      </header>
      <div class="wallet-kpi-grid">
        <div><span>Profitability</span><strong>${scoreFormat(summary.index)}</strong><small>history-based index</small></div>
        <div><span>Active LP</span><strong>${formatUsd(summary.lpUsd)}</strong><small>${summary.positions.length} NFT${summary.positions.length === 1 ? '' : 's'} / ${custodySummary(summary.positions, wallet)}</small></div>
        <div><span>APR</span><strong>${summary.aprPct === undefined ? 'n/a' : percentFormat(summary.aprPct, 2)}</strong><small>${aprBreakdown(summary, summary.positions)}</small></div>
        <div><span>Pending</span><strong>${formatTokenAmount(summary.pendingAero, 18, 4)} AERO</strong><small>${summary.positions.length === 0 ? 'no active LP' : summary.positions.some((position) => position.staked) ? formatUsd(summary.pendingAeroUsd) : 'not gauge-staked'}</small></div>
        <div><span>LP split</span><strong>${sideSplit}</strong><small>${rangeHeadroom}</small></div>
        <div><span>Total tracked</span><strong>${formatUsd(totalTrackedUsd)}</strong><small>${formatUsd(summary.lpUsd)} LP / ${formatUsd(walletUsd)} idle</small></div>
      </div>
      ${renderUptime(uptime, summary.rangeState)}
      <div id="${walletChartId(wallet, index)}" class="lp-price-chart wallet-chart" aria-live="polite"></div>
      ${renderPositionParameters(snapshot, wallet, summary.positions)}
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
    const positionWallets = snapshot.trackedWallets.filter((item) => {
      const addresses = new Set(trackedPositionAddresses(item).map((address) => address.toLowerCase()));
      return (
        (position.depositor !== undefined && addresses.has(position.depositor.toLowerCase())) ||
        (position.owner !== undefined && addresses.has(position.owner.toLowerCase()))
      );
    });
    const wallet = positionWallets[0];
    const status = position.tickLower !== undefined && position.tickUpper !== undefined
      ? statusLabel(rangeStatus(snapshot.pool.currentTick, position.tickLower, position.tickUpper).state).toLowerCase()
      : 'range unknown';
    const range = position.tickLower !== undefined && position.tickUpper !== undefined
      ? `${tickLabel(position.tickLower)} to ${tickLabel(position.tickUpper)}`
      : 'range unknown';
    return `
          <div class="timeline-row">
            <span>NFT #${position.tokenId.toString()}</span>
            <div>
              <strong>${wallet?.shortLabel ?? 'Tracked wallet'} / ${positionCustodyLabel(position, wallet)}</strong>
              <p>${status} / ${range} / liquidity ${compactNumber(position.liquidity)}${position.liveWarning ? ` / ${position.liveWarning}` : ''}</p>
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
        candles: historicalCandles,
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
installTooltips();
void refresh();
