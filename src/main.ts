import './styles.css';

import {
  compactAddress,
  emissionAprPct,
  estimatePositionTokenAmounts,
  formatTokenAmount,
  formatUsd,
  percentFormat,
  rangeStatus,
  rawToDecimal,
  tickLabel,
  tickToAdjustedPrice,
  usdBreakdown,
  type PositionAmountEstimate,
  type UsdBreakdown,
} from './aero-math';
import { CONTRACTS, TOKEN_META, WALLET_ADDRESS } from './config';
import { DASHBOARD_SECTION_ORDER, type DashboardSectionId } from './dashboard-layout';
import { renderLpRangeChart } from './lp-range-chart';
import { positionHistory } from './positions';
import { loadDashboardSnapshot, tokenDecimals, type DashboardSnapshot, type LivePosition } from './rpc';

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

function tokenSymbol(address: string | undefined, fallback: string): string {
  if (!address) return fallback;
  return Object.entries(TOKEN_META).find(([knownAddress]) => knownAddress.toLowerCase() === address.toLowerCase())?.[1].symbol ?? fallback;
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
          <p class="eyebrow">Base · Aerodrome Slipstream · CL200</p>
          <h1>Clawberto LP Console</h1>
        </div>
        <nav class="toplinks" aria-label="Protocol links">
          <a href="${addressLink(CONTRACTS.pool)}" target="_blank" rel="noreferrer">Pool</a>
          <a href="${addressLink(CONTRACTS.gauge)}" target="_blank" rel="noreferrer">Gauge</a>
          <a href="${addressLink(WALLET_ADDRESS)}" target="_blank" rel="noreferrer">Wallet</a>
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

interface PositionValuation {
  amounts?: PositionAmountEstimate;
  usd?: UsdBreakdown;
  aprPct?: number;
  pendingAeroUsd?: number;
}

function positionValuation(position: LivePosition, snapshot: DashboardSnapshot): PositionValuation {
  if (position.liquidity === undefined || position.tickLower === undefined || position.tickUpper === undefined) return {};

  const token0Decimals = tokenDecimals(position.token0);
  const token1Decimals = tokenDecimals(position.token1);
  const lfiUsd = tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
  const token0Symbol = tokenSymbol(position.token0, 'token0');
  const token1Symbol = tokenSymbol(position.token1, 'token1');
  const token0Usd = token0Symbol === 'USDC' ? 1 : lfiUsd;
  const token1Usd = token1Symbol === 'USDC' ? 1 : lfiUsd;
  const amounts = estimatePositionTokenAmounts({
    liquidity: position.liquidity,
    currentTick: snapshot.pool.currentTick,
    lowerTick: position.tickLower,
    upperTick: position.tickUpper,
    token0Decimals,
    token1Decimals,
  });
  const usd = usdBreakdown(amounts, token0Usd, token1Usd);
  const aprPct = snapshot.market.aeroUsd
    ? emissionAprPct({
      rewardRateRaw: snapshot.pool.rewardRate,
      rewardTokenDecimals: 18,
      rewardTokenUsd: snapshot.market.aeroUsd,
      positionLiquidity: position.liquidity,
      totalStakedLiquidity: snapshot.pool.stakedLiquidity,
      positionUsd: usd.totalUsd,
    })
    : undefined;
  const pendingAeroUsd = snapshot.market.aeroUsd && position.earnedAero !== undefined
    ? rawToDecimal(position.earnedAero, 18) * snapshot.market.aeroUsd
    : undefined;

  return { amounts, usd, aprPct, pendingAeroUsd };
}

function renderRangeConsole(snapshot: DashboardSnapshot): string {
  const price = tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
  const readablePositions = snapshot.positions.filter((position) => !position.liveError && position.tickLower !== undefined && position.tickUpper !== undefined);
  const primary = readablePositions[0];
  const primaryStatus = primary?.tickLower !== undefined && primary.tickUpper !== undefined
    ? rangeStatus(snapshot.pool.currentTick, primary.tickLower, primary.tickUpper)
    : undefined;
  const primaryValuation = primary ? positionValuation(primary, snapshot) : undefined;
  const pendingAero = primary?.earnedAero !== undefined ? formatTokenAmount(primary.earnedAero, 18, 6) : 'n/a';
  const apr = primaryValuation?.aprPct !== undefined ? percentFormat(primaryValuation.aprPct, 2) : 'n/a';

  return `
    <section class="range-console" data-section="range-control">
      <div class="console-head">
        <div>
          <p class="eyebrow">LP range first</p>
          <h2>LFI/USDC active band</h2>
          <p>Current price <b>${formatUsd(price, 8)}</b> per LFI · tick <b>${tickLabel(snapshot.pool.currentTick)}</b></p>
        </div>
        <div class="head-metrics">
          <span class="status ${primaryStatus ? stateClass(primaryStatus.state) : ''}">${primaryStatus?.state ?? 'UNKNOWN'}</span>
          <span>${readablePositions.length} readable / ${snapshot.positions.length} tracked</span>
          <span>updated ${snapshot.loadedAt.toLocaleTimeString()}</span>
        </div>
      </div>
      <div class="range-layout">
        <div class="chart-card">
          <div id="lp-price-chart" class="lp-price-chart range-first-chart" aria-live="polite"></div>
          <div class="chart-note">Live GeckoTerminal candles with Base RPC NFT range bands. If candles fail, the on-chain range state still renders.</div>
        </div>
        <aside class="range-sidecar">
          <div class="sidecar-row">
            <span>Primary NFT</span>
            <strong>${primary ? `#${primary.tokenId.toString()}` : 'n/a'}</strong>
          </div>
          <div class="sidecar-row triple">
            <span>Lower</span><strong>${primary?.tickLower !== undefined ? tickLabel(primary.tickLower) : 'n/a'}</strong>
            <span>Current</span><strong>${tickLabel(snapshot.pool.currentTick)}</strong>
            <span>Upper</span><strong>${primary?.tickUpper !== undefined ? tickLabel(primary.tickUpper) : 'n/a'}</strong>
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
          </div>
        </aside>
      </div>
    </section>
  `;
}

function renderPoolStats(snapshot: DashboardSnapshot): string {
  const price = tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
  const aeroPerDay = rawToDecimal(snapshot.pool.rewardRate, 18) * 86_400;
  const stakedRatio = snapshot.pool.liquidity > 0n ? (Number(snapshot.pool.stakedLiquidity) / Number(snapshot.pool.liquidity)) * 100 : 0;

  return `
    <section class="metric-strip" data-section="pool-metrics">
      <article><span>USDC / LFI</span><strong>${formatUsd(price, 8)}</strong></article>
      <article><span>Pool fee</span><strong>${(snapshot.pool.fee / 10_000).toFixed(2)}%</strong></article>
      <article><span>AERO / day</span><strong>${numberFormat(aeroPerDay, 2)}</strong></article>
      <article><span>AERO left</span><strong>${formatTokenAmount(snapshot.pool.rewardsLeft, 18, 2)}</strong></article>
      <article><span>Pool liquidity</span><strong>${compactNumber(snapshot.pool.liquidity)}</strong></article>
      <article><span>Staked</span><strong>${percentFormat(stakedRatio, 1)}</strong></article>
    </section>
  `;
}

function renderWallet(snapshot: DashboardSnapshot): string {
  return `
    <section class="panel wallet-panel" data-section="wallet-secondary">
      <div>
        <p class="eyebrow">Secondary wallet view</p>
        <h2>${compactAddress(WALLET_ADDRESS)}</h2>
      </div>
      <div class="wallet-balances">
        <span><b>${formatTokenAmount(snapshot.walletBalances.eth, 18, 6)}</b> ETH</span>
        <span><b>${formatTokenAmount(snapshot.walletBalances.lfi, 18, 2)}</b> LFI</span>
        <span><b>${formatTokenAmount(snapshot.walletBalances.usdc, 6, 4)}</b> USDC</span>
        <span><b>${formatTokenAmount(snapshot.walletBalances.aero, 18, 4)}</b> AERO</span>
      </div>
    </section>
  `;
}

function renderTickStrip(position: LivePosition, currentTick: number): string {
  if (position.tickLower === undefined || position.tickUpper === undefined || position.tickSpacing === undefined) return '';
  const cells: string[] = [];
  for (let tick = position.tickLower; tick < position.tickUpper; tick += position.tickSpacing) {
    const active = currentTick >= tick && currentTick < tick + position.tickSpacing;
    const passed = currentTick >= tick + position.tickSpacing;
    cells.push(`<span title="${tickLabel(tick)} → ${tickLabel(tick + position.tickSpacing)}" class="tick-cell ${active ? 'active' : passed ? 'passed' : ''}"></span>`);
  }
  return `<div class="tick-strip">${cells.join('')}</div>`;
}

function renderPositionCard(position: LivePosition, snapshot: DashboardSnapshot): string {
  if (position.liveError) {
    return `
      <article class="position-card error-card">
        <h3>#${position.tokenId.toString()} · ${position.label}</h3>
        <p>${position.liveError}</p>
      </article>
    `;
  }

  const status = position.tickLower !== undefined && position.tickUpper !== undefined
    ? rangeStatus(snapshot.pool.currentTick, position.tickLower, position.tickUpper)
    : undefined;
  const valuation = positionValuation(position, snapshot);
  const token0 = tokenSymbol(position.token0, 'token0');
  const token1 = tokenSymbol(position.token1, 'token1');
  const owed = [
    position.tokensOwed0 !== undefined ? `${formatTokenAmount(position.tokensOwed0, tokenDecimals(position.token0), 8)} ${token0}` : undefined,
    position.tokensOwed1 !== undefined ? `${formatTokenAmount(position.tokensOwed1, tokenDecimals(position.token1), 8)} ${token1}` : undefined,
  ].filter(Boolean).join(' · ') || 'n/a';
  const earnedAero = position.earnedAero !== undefined ? formatTokenAmount(position.earnedAero, 18, 6) : 'n/a';
  const apr = valuation.aprPct !== undefined ? percentFormat(valuation.aprPct, 2) : 'n/a';

  return `
    <article class="position-card">
      <header>
        <div>
          <p class="eyebrow">${position.origin.replace('-', ' ')}</p>
          <h3>NFT #${position.tokenId.toString()}</h3>
        </div>
        <span class="status ${status ? stateClass(status.state) : ''}">${status?.state ?? 'UNKNOWN'}</span>
      </header>
      <div class="position-main">
        <div><span class="metric-label">Lower</span><strong>${position.tickLower !== undefined ? tickLabel(position.tickLower) : 'n/a'}</strong></div>
        <div><span class="metric-label">Current</span><strong>${tickLabel(snapshot.pool.currentTick)}</strong></div>
        <div><span class="metric-label">Upper</span><strong>${position.tickUpper !== undefined ? tickLabel(position.tickUpper) : 'n/a'}</strong></div>
      </div>
      ${renderTickStrip(position, snapshot.pool.currentTick)}
      <div class="asset-split">
        <div><span>${token0}</span><strong>${formatUsd(valuation.usd?.token0Usd)}</strong><small>${valuation.amounts ? numberFormat(valuation.amounts.token0, 4) : 'n/a'} ${token0}</small></div>
        <div><span>${token1}</span><strong>${formatUsd(valuation.usd?.token1Usd)}</strong><small>${valuation.amounts ? numberFormat(valuation.amounts.token1, 4) : 'n/a'} ${token1}</small></div>
      </div>
      <div class="position-details">
        <span>NFT value <b>${formatUsd(valuation.usd?.totalUsd)}</b></span>
        <span>Pending AERO <b>${earnedAero}</b></span>
        <span>Emission APR <b>${apr}</b></span>
        <span>Owed fees <b>${owed}</b></span>
        <span>Custody <b>${position.staked === undefined ? 'n/a' : position.staked ? 'gauge staked' : 'wallet'}</b></span>
        <span>Liquidity <b>${compactNumber(position.liquidity)}</b></span>
        <span>Owner <b>${position.owner ? compactAddress(position.owner) : 'n/a'}</b></span>
        <span>Headroom <b>${status ? `${percentFormat(status.lowerHeadroomPct, 1)} / ${percentFormat(status.upperHeadroomPct, 1)}` : 'n/a'}</b></span>
      </div>
      <details class="tx-details">
        <summary>Setup txs and notes</summary>
        <p>${position.notes}</p>
        <div class="tx-list">
          ${position.setupTxs.length === 0 ? '<span>No Hermes setup txs recorded.</span>' : position.setupTxs.map((tx) => `<a href="${txLink(tx.hash)}" target="_blank" rel="noreferrer">${tx.label}</a>`).join('')}
        </div>
      </details>
    </article>
  `;
}

function renderPositions(snapshot: DashboardSnapshot): string {
  const activePositions = snapshot.positions.filter((position) => !position.liveError);
  const cards = activePositions.length === 0
    ? '<article class="position-card empty-card"><h3>No current LP positions</h3><p>The active registry is empty. Historical entries remain below so exited LPs are still visible.</p></article>'
    : activePositions.map((position) => renderPositionCard(position, snapshot)).join('');
  return `
    <section class="positions-section" data-section="positions-primary">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Active positions</p>
          <h2>Range, USD split, rewards</h2>
        </div>
        <span class="pill">${activePositions.length} active / ${snapshot.positions.length} tracked</span>
      </div>
      <div class="position-grid">${cards}</div>
    </section>
  `;
}

function renderHistory(snapshot: DashboardSnapshot): string {
  const issuePositions = snapshot.positions.filter((position) => position.liveError);
  const issueRows = issuePositions.map((position) => `
          <div class="timeline-row diagnostic-row">
            <span>Live read</span>
            <div>
              <strong>#${position.tokenId.toString()} · ${position.label}</strong>
              <p>${position.liveError}</p>
            </div>
          </div>
        `).join('');
  return `
    <details class="panel history-panel" data-section="history-secondary">
      <summary>
        <span><b>LP history</b><em>${positionHistory.length} events${issuePositions.length ? ` · ${issuePositions.length} reference read issue${issuePositions.length === 1 ? '' : 's'}` : ''}, collapsed to keep range first</em></span>
        <strong>Open</strong>
      </summary>
      <div class="timeline">
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

function renderDashboard(snapshot: DashboardSnapshot): void {
  const sections: Record<DashboardSectionId, string> = {
    'range-control': renderRangeConsole(snapshot),
    'positions-primary': renderPositions(snapshot),
    'pool-metrics': renderPoolStats(snapshot),
    'wallet-secondary': renderWallet(snapshot),
    'history-secondary': renderHistory(snapshot),
  };
  renderShell(DASHBOARD_SECTION_ORDER.map((section) => sections[section]).join(''));
  const chartMount = document.querySelector<HTMLElement>('#lp-price-chart');
  if (chartMount) void renderLpRangeChart(snapshot, chartMount);
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