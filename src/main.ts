import './styles.css';

import { CONTRACTS, TOKEN_META, WALLET_ADDRESS } from './config';
import { compactAddress, formatTokenAmount, percentFormat, rangeStatus, tickLabel, tickToAdjustedPrice } from './aero-math';
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

function renderShell(content: string): void {
  app.innerHTML = `
    <main class="shell">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Base · Aerodrome Slipstream · CL200</p>
          <h1>Clawberto LP Range Console</h1>
          <p class="subtitle">Live tick health, staked custody, reward state, and full LP history for every position Hermes sets up.</p>
          <div class="hero-actions">
            <a href="${addressLink(CONTRACTS.pool)}" target="_blank" rel="noreferrer">Pool</a>
            <a href="${addressLink(CONTRACTS.gauge)}" target="_blank" rel="noreferrer">Gauge</a>
            <a href="${addressLink(WALLET_ADDRESS)}" target="_blank" rel="noreferrer">Wallet</a>
          </div>
        </div>
        <div class="hero-card">
          <span class="pulse"></span>
          <strong>Realtime RPC</strong>
          <small>Auto-refreshing every ${REFRESH_MS / 1000}s from Base mainnet</small>
        </div>
      </section>
      ${content}
    </main>
  `;
}

function renderLoading(): void {
  renderShell(`
    <section class="panel loading-panel">
      <div class="loader"></div>
      <div>
        <h2>Loading live LP state</h2>
        <p>Reading pool slot0, NFT ranges, gauge staking, wallet balances, and rewards.</p>
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

function renderPoolStats(snapshot: DashboardSnapshot): string {
  const price = tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
  return `
    <section class="stats-grid">
      <article class="stat-card brand">
        <span>Current Tick</span>
        <strong>${tickLabel(snapshot.pool.currentTick)}</strong>
        <small>LFI/USDC live slot0</small>
      </article>
      <article class="stat-card">
        <span>USDC per LFI</span>
        <strong>$${price.toFixed(8)}</strong>
        <small>Tick-adjusted for 18/6 decimals</small>
      </article>
      <article class="stat-card">
        <span>Pool Fee</span>
        <strong>${(snapshot.pool.fee / 10_000).toFixed(2)}%</strong>
        <small>CL200 concentrated pool</small>
      </article>
      <article class="stat-card">
        <span>AERO Left</span>
        <strong>${formatTokenAmount(snapshot.pool.rewardsLeft, 18, 2)}</strong>
        <small>Gauge emission reserve</small>
      </article>
    </section>
  `;
}

function renderWallet(snapshot: DashboardSnapshot): string {
  return `
    <section class="panel wallet-panel">
      <div>
        <p class="eyebrow">Main wallet</p>
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

function renderMasterRange(snapshot: DashboardSnapshot): string {
  const visible = snapshot.positions.filter((position) => position.tickLower !== undefined && position.tickUpper !== undefined);
  if (visible.length === 0) {
    return '<section class="panel"><h2>No live LP ranges</h2><p>No readable NFT positions are configured right now.</p></section>';
  }

  const lowerBound = Math.min(...visible.map((position) => position.tickLower!), snapshot.pool.currentTick) - 800;
  const upperBound = Math.max(...visible.map((position) => position.tickUpper!), snapshot.pool.currentTick) + 800;
  const scale = (tick: number) => ((tick - lowerBound) / (upperBound - lowerBound)) * 100;
  const tickMarks = Array.from({ length: 9 }, (_, index) => Math.round(lowerBound + ((upperBound - lowerBound) * index) / 8));

  const bars = visible.map((position, index) => {
    const lower = scale(position.tickLower!);
    const width = scale(position.tickUpper!) - lower;
    const y = 98 + index * 54;
    const status = rangeStatus(snapshot.pool.currentTick, position.tickLower!, position.tickUpper!);
    return `
      <g>
        <rect x="${lower}%" y="${y}" width="${width}%" height="28" rx="12" class="range-bar ${stateClass(status.state)}"></rect>
        <text x="${Math.min(96, lower + 1)}%" y="${y + 19}" class="svg-label">#${position.tokenId.toString()} · ${position.label}</text>
      </g>
    `;
  }).join('');

  const markerX = scale(snapshot.pool.currentTick);
  return `
    <section class="panel graph-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Global tick map</p>
          <h2>Live range overlay</h2>
        </div>
        <span class="pill">Current tick ${tickLabel(snapshot.pool.currentTick)}</span>
      </div>
      <svg class="range-svg" viewBox="0 0 1200 ${170 + visible.length * 54}" preserveAspectRatio="none" role="img" aria-label="LP tick range map">
        <defs>
          <linearGradient id="gridFade" x1="0" x2="1">
            <stop offset="0%" stop-color="#7132f5" stop-opacity="0.1"></stop>
            <stop offset="50%" stop-color="#14f1d9" stop-opacity="0.25"></stop>
            <stop offset="100%" stop-color="#7132f5" stop-opacity="0.1"></stop>
          </linearGradient>
        </defs>
        <rect x="0" y="18" width="1200" height="${130 + visible.length * 54}" rx="28" fill="url(#gridFade)"></rect>
        ${tickMarks.map((tick) => `<line x1="${scale(tick)}%" x2="${scale(tick)}%" y1="32" y2="${130 + visible.length * 54}" class="grid-line"></line><text x="${scale(tick)}%" y="54" class="tick-label">${tickLabel(tick)}</text>`).join('')}
        ${bars}
        <line x1="${markerX}%" x2="${markerX}%" y1="18" y2="${150 + visible.length * 54}" class="current-line"></line>
        <circle cx="${markerX}%" cy="28" r="9" class="current-dot"></circle>
      </svg>
    </section>
  `;
}

function renderPriceChartPanel(snapshot: DashboardSnapshot): string {
  const readableRanges = snapshot.positions.filter((position) => position.tickLower !== undefined && position.tickUpper !== undefined && !position.liveError).length;
  return `
    <section class="panel price-chart-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Price action</p>
          <h2>Candles with LP range bands</h2>
        </div>
        <span class="pill">${readableRanges} charted ranges</span>
      </div>
      <div id="lp-price-chart" class="lp-price-chart" aria-live="polite"></div>
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

function renderPositionCard(position: LivePosition, currentTick: number): string {
  if (position.liveError) {
    return `
      <article class="position-card error-card">
        <h3>#${position.tokenId.toString()} · ${position.label}</h3>
        <p>${position.liveError}</p>
      </article>
    `;
  }
  const status = position.tickLower !== undefined && position.tickUpper !== undefined
    ? rangeStatus(currentTick, position.tickLower, position.tickUpper)
    : undefined;
  const deposited = position.deposited
    ? `${formatTokenAmount(position.deposited.lfiRaw, 18, 4)} LFI · ${formatTokenAmount(position.deposited.usdcRaw, 6, 2)} USDC`
    : 'n/a';
  const owed = [
    position.tokensOwed0 !== undefined ? `${formatTokenAmount(position.tokensOwed0, tokenDecimals(position.token0), 8)} ${tokenSymbol(position.token0, 'token0')}` : undefined,
    position.tokensOwed1 !== undefined ? `${formatTokenAmount(position.tokensOwed1, tokenDecimals(position.token1), 8)} ${tokenSymbol(position.token1, 'token1')}` : undefined,
  ].filter(Boolean).join(' · ') || 'n/a';
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
        <div>
          <span class="metric-label">Lower</span>
          <strong>${position.tickLower !== undefined ? tickLabel(position.tickLower) : 'n/a'}</strong>
        </div>
        <div>
          <span class="metric-label">Current</span>
          <strong>${tickLabel(currentTick)}</strong>
        </div>
        <div>
          <span class="metric-label">Upper</span>
          <strong>${position.tickUpper !== undefined ? tickLabel(position.tickUpper) : 'n/a'}</strong>
        </div>
      </div>
      ${renderTickStrip(position, currentTick)}
      <div class="position-details">
        <span>Owner: <b>${position.owner ? compactAddress(position.owner) : 'n/a'}</b></span>
        <span>Staked: <b>${position.staked === undefined ? 'n/a' : position.staked ? 'yes' : 'no'}</b></span>
        <span>Liquidity: <b>${position.liquidity?.toString() ?? 'n/a'}</b></span>
        <span>Deposited: <b>${deposited}</b></span>
        <span>Owed fees: <b>${owed}</b></span>
        <span>Earned AERO: <b>${formatTokenAmount(position.earnedAero ?? 0n, 18, 8)}</b></span>
        <span>Headroom: <b>${status ? `${percentFormat(status.lowerHeadroomPct, 1)} lower · ${percentFormat(status.upperHeadroomPct, 1)} upper` : 'n/a'}</b></span>
      </div>
      <p>${position.notes}</p>
      <div class="tx-list">
        ${position.setupTxs.length === 0 ? '<span>No Hermes setup txs recorded.</span>' : position.setupTxs.map((tx) => `<a href="${txLink(tx.hash)}" target="_blank" rel="noreferrer">${tx.label}</a>`).join('')}
      </div>
    </article>
  `;
}

function renderPositions(snapshot: DashboardSnapshot): string {
  const cards = snapshot.positions.length === 0
    ? '<article class="position-card empty-card"><h3>No current LP positions</h3><p>The active registry is empty. Historical entries remain below so exited LPs are still visible.</p></article>'
    : snapshot.positions.map((position) => renderPositionCard(position, snapshot.pool.currentTick)).join('');
  return `
    <section class="positions-section">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Managed LPs</p>
          <h2>Position status</h2>
        </div>
        <span class="pill">${snapshot.positions.length} tracked NFTs</span>
      </div>
      <div class="position-grid">${cards}</div>
    </section>
  `;
}

function renderHistory(): string {
  return `
    <section class="panel history-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Audit trail</p>
          <h2>LP history</h2>
        </div>
      </div>
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
      </div>
    </section>
  `;
}

function renderDashboard(snapshot: DashboardSnapshot): void {
  renderShell(`
    <div class="topline">Last updated ${snapshot.loadedAt.toLocaleTimeString()} · Base chain live reads</div>
    ${renderPoolStats(snapshot)}
    ${renderWallet(snapshot)}
    ${renderMasterRange(snapshot)}
    ${renderPriceChartPanel(snapshot)}
    ${renderPositions(snapshot)}
    ${renderHistory()}
  `);
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
