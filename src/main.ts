import './styles.css';

import {
  compactAddress,
  formatTokenAmount,
  formatUsd,
  percentFormat,
  rangeStatus,
  rawToDecimal,
  tickLabel,
  tickToAdjustedPrice,
} from './aero-math';
import { COMPARISON_WALLET_ADDRESS, CONTRACTS, WALLET_ADDRESS } from './config';
import { DASHBOARD_SECTION_ORDER, type DashboardSectionId } from './dashboard-layout';
import { renderBottomAnalytics } from './bottom-analytics';
import { renderLpRangeChart } from './lp-range-chart';
import { positionValuation, walletUsdValue } from './position-valuation';
import { positionHistory } from './positions';
import { loadDashboardSnapshot, type DashboardSnapshot, type TrackedWalletSnapshot } from './rpc';

const REFRESH_MS = 15_000;
const app = document.querySelector<HTMLDivElement>('#app') ?? failMissingRoot();

function failMissingRoot(): never {
  throw new Error('Missing #app root');
}

let refreshTimer: number | undefined;

function txLink(hash: `0x${string}`): string {
  return `https://basescan.org/tx/${hash}`;
}

function addressLink(address: string): string {
  return `https://basescan.org/address/${address}`;
}

function stateClass(state: string): string {
  return state.toLowerCase().replaceAll('_', '-');
}

function numberFormat(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function compactNumber(value: bigint | number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a';
  const numeric = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return 'n/a';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(numeric);
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

function trackedWalletLpValue(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot): number {
  return trackedWalletPositions(snapshot, wallet)
    .filter((position) => position.liquidity !== undefined && position.liquidity > 0n)
    .reduce((sum, position) => sum + (positionValuation(position, snapshot).usd?.totalUsd ?? 0), 0);
}

function renderTrackedWalletStrip(snapshot: DashboardSnapshot): string {
  return `
    <div class="tracked-wallet-strip" aria-label="Tracked wallet live balances">
      ${snapshot.trackedWallets.map((wallet) => {
        const walletUsd = walletUsdValue(snapshot, wallet.balances);
        const lpUsd = trackedWalletLpValue(snapshot, wallet);
        const activeLpCount = trackedWalletPositions(snapshot, wallet)
          .filter((position) => position.liquidity !== undefined && position.liquidity > 0n)
          .length;
        return `
          <article class="tracked-wallet-card">
            <header>
              <span>${wallet.shortLabel}</span>
              <a href="${addressLink(wallet.address)}" target="_blank" rel="noreferrer">${compactAddress(wallet.address)}</a>
            </header>
            <strong>${formatUsd(walletUsd)}</strong>
            <small>${formatTokenAmount(wallet.balances.lfi, 18, 2)} LFI / ${formatTokenAmount(wallet.balances.usdc, 6, 2)} USDC / ${formatTokenAmount(wallet.balances.aero, 18, 4)} AERO</small>
            <em>Active LP ${formatUsd(lpUsd)} / ${activeLpCount} NFT${activeLpCount === 1 ? '' : 's'}</em>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderRangeConsole(snapshot: DashboardSnapshot): string {
  const price = tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
  const aeroPerDay = rawToDecimal(snapshot.pool.rewardRate, 18) * 86_400;
  const readablePositions = snapshot.positions.filter((position) => !position.liveError && position.tickLower !== undefined && position.tickUpper !== undefined);
  const primary = readablePositions.find((position) => position.liquidity !== undefined && position.liquidity > 0n);
  const primaryStatus = primary?.tickLower !== undefined && primary.tickUpper !== undefined
    ? rangeStatus(snapshot.pool.currentTick, primary.tickLower, primary.tickUpper)
    : undefined;
  const primaryValuation = primary ? positionValuation(primary, snapshot) : undefined;
  const pendingAero = primary?.earnedAero !== undefined ? formatTokenAmount(primary.earnedAero, 18, 6) : 'n/a';
  const apr = primaryValuation?.aprPct !== undefined ? percentFormat(primaryValuation.aprPct, 2) : 'n/a';
  const sidecar = primary ? `
    <aside class="range-sidecar">
      <div class="sidecar-row">
        <span>Primary NFT</span>
        <strong>#${primary.tokenId.toString()}</strong>
      </div>
      <div class="sidecar-row triple">
        <span>Lower</span><strong>${primary.tickLower !== undefined ? tickLabel(primary.tickLower) : 'n/a'}</strong>
        <span>Current</span><strong>${tickLabel(snapshot.pool.currentTick)}</strong>
        <span>Upper</span><strong>${primary.tickUpper !== undefined ? tickLabel(primary.tickUpper) : 'n/a'}</strong>
      </div>
      <div class="split-card">
        <span>USD size by side</span>
        <div class="split-line"><b>LFI</b><strong>${formatUsd(primaryValuation?.usd?.token0Usd)}</strong><em>${primaryValuation?.amounts ? `${numberFormat(primaryValuation.amounts.token0, 4)} LFI` : 'n/a'}</em></div>
        <div class="split-line"><b>USDC</b><strong>${formatUsd(primaryValuation?.usd?.token1Usd)}</strong><em>${primaryValuation?.amounts ? `${numberFormat(primaryValuation.amounts.token1, 4)} USDC` : 'n/a'}</em></div>
        <div class="split-total"><span>NFT total</span><strong>${formatUsd(primaryValuation?.usd?.totalUsd)}</strong></div>
      </div>
      <div class="reward-grid">
        <div><span>Pending AERO</span><strong>${pendingAero}</strong><small>${formatUsd(primaryValuation?.pendingAeroUsd)}</small></div>
        <div><span>Emission APR</span><strong>${apr}</strong><small>${snapshot.market.aeroUsd ? `AERO ${formatUsd(snapshot.market.aeroUsd, 4)}` : 'price n/a'}</small></div>
        <div><span>Pool fee</span><strong>${(snapshot.pool.fee / 10_000).toFixed(2)}%</strong><small>Aerodrome CL fee</small></div>
        <div><span>AERO/day</span><strong>${numberFormat(aeroPerDay, 2)}</strong><small>${formatTokenAmount(snapshot.pool.rewardsLeft, 18, 2)} left</small></div>
      </div>
    </aside>
  ` : `
    <aside class="range-sidecar compact-sidecar">
      <div class="sidecar-row">
        <span>Active LP</span>
        <strong>none</strong>
      </div>
      <div class="sidecar-row triple">
        <span>Current tick</span><strong>${tickLabel(snapshot.pool.currentTick)}</strong>
        <span>Readable NFTs</span><strong>${readablePositions.length}/${snapshot.positions.length}</strong>
      </div>
      <div class="sidecar-row triple">
        <span>Wallet NFTs scanned</span><strong>${snapshot.positionDiscovery.walletNftsScanned}</strong>
        <span>Gauge NFTs scanned</span><strong>${snapshot.positionDiscovery.gaugeNftsScanned}</strong>
      </div>
      <div class="reward-grid">
        <div><span>Pool fee</span><strong>${(snapshot.pool.fee / 10_000).toFixed(2)}%</strong><small>Aerodrome CL fee</small></div>
        <div><span>AERO/day</span><strong>${numberFormat(aeroPerDay, 2)}</strong><small>${formatTokenAmount(snapshot.pool.rewardsLeft, 18, 2)} left</small></div>
      </div>
      <p class="sidecar-note">${snapshot.positionDiscovery.error ? `Discovery issue: ${snapshot.positionDiscovery.error}` : snapshot.positionDiscovery.source}</p>
    </aside>
  `;

  return `
    <section class="range-console" data-section="range-control">
      <div class="console-head">
        <div>
          <p class="eyebrow">LP range first</p>
          <h2>LFI/USDC active band</h2>
          <p>Current price <b>${formatUsd(price, 8)}</b> per LFI / tick <b>${tickLabel(snapshot.pool.currentTick)}</b></p>
        </div>
        <div class="head-metrics">
          <span class="status ${primaryStatus ? stateClass(primaryStatus.state) : ''}">${primaryStatus?.state ?? 'UNKNOWN'}</span>
          <span>${readablePositions.length} readable / ${snapshot.positions.length} tracked</span>
          <span>updated ${snapshot.loadedAt.toLocaleTimeString()}</span>
        </div>
      </div>
      ${renderTrackedWalletStrip(snapshot)}
      <div class="range-layout">
        <div class="chart-card">
          <div id="lp-price-chart" class="lp-price-chart range-first-chart" aria-live="polite"></div>
        </div>
        ${sidecar}
      </div>
    </section>
  `;
}

function renderDiagnostics(snapshot: DashboardSnapshot): string {
  const stakedRatio = snapshot.pool.liquidity > 0n ? (Number(snapshot.pool.stakedLiquidity) / Number(snapshot.pool.liquidity)) * 100 : 0;
  const issuePositions = snapshot.positions.filter((position) => position.liveError);
  const issueRows = issuePositions.map((position) => `
          <div class="timeline-row diagnostic-row">
            <span>Live read</span>
            <div>
              <strong>#${position.tokenId.toString()} / ${position.label}</strong>
              <p>${position.liveError}</p>
            </div>
          </div>
        `).join('');
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
        <span><b>Diagnostics</b><em>Pool liquidity ${compactNumber(snapshot.pool.liquidity)} / staked ${percentFormat(stakedRatio, 1)} / discovery ${snapshot.positionDiscovery.discoveredRecords} live candidate${snapshot.positionDiscovery.discoveredRecords === 1 ? '' : 's'}${issuePositions.length ? ` / ${issuePositions.length} read issue${issuePositions.length === 1 ? '' : 's'}` : ''}</em></span>
        <strong>Open details</strong>
      </summary>
      <div class="timeline">
        <div class="timeline-row">
          <span>Discovery</span>
          <div>
            <strong>${snapshot.positionDiscovery.source}</strong>
            <p>${snapshot.positionDiscovery.walletNftsScanned} wallet NFTs scanned / ${snapshot.positionDiscovery.gaugeNftsScanned} gauge NFTs scanned / ${snapshot.positionDiscovery.discoveredRecords} tracked candidates${snapshot.positionDiscovery.error ? ` / ${snapshot.positionDiscovery.error}` : ''}</p>
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
        ${positionHistory.map((event) => `
          <div class="timeline-row">
            <span>${event.date}</span>
            <div>
              <strong>${event.event}</strong>
              <p>${event.detail}</p>
              ${event.tx ? `<a href="${txLink(event.tx)}" target="_blank" rel="noreferrer">${compactAddress(event.tx, 10, 8)}</a>` : ''}
            </div>
          </div>
        `).join('')}
        ${issueRows}
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

function renderDashboard(snapshot: DashboardSnapshot): void {
  const sections: Record<DashboardSectionId, string> = {
    'range-control': renderRangeConsole(snapshot),
    'analytics-bottom': renderAnalyticsPlaceholder(),
    'diagnostics-secondary': renderDiagnostics(snapshot),
  };
  renderShell(DASHBOARD_SECTION_ORDER.map((section) => sections[section]).join(''));
  const chartMount = document.querySelector<HTMLElement>('#lp-price-chart');
  if (chartMount) void renderLpRangeChart(snapshot, chartMount);
  const analyticsMount = document.querySelector<HTMLElement>('#analytics-bottom');
  if (analyticsMount) void renderBottomAnalytics(snapshot, analyticsMount);
}

async function refresh(): Promise<void> {
  window.clearTimeout(refreshTimer);
  try {
    const snapshot = await loadDashboardSnapshot();
    renderDashboard(snapshot);
  } catch (error) {
    renderError(error);
  } finally {
    refreshTimer = window.setTimeout(() => void refresh(), REFRESH_MS);
  }
}

renderLoading();
void refresh();
