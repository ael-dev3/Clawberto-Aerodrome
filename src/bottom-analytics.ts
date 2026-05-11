import {
  estimatedFeeAprPct,
  formatUsd,
  percentFormat,
  rangeStatus,
  rawToDecimal,
  tickLabel,
} from './aero-math';
import {
  HISTORICAL_HOURLY_CANDLE_LIMIT,
  PRICE_CHANGE_WINDOWS,
  VOLATILITY_HEATMAP_DAYS,
  priceWindowChanges,
  realizedVolatilityPct,
  suggestedLpRangeFromCandles,
  volatilityHeatmap,
} from './analytics';
import { CONTRACTS } from './config';
import { fetchGeckoPoolOhlcv, type GeckoCandle } from './gecko';
import {
  lfiUsd,
  poolReserveBreakdown,
  positionValuation,
  walletLfiExposurePct,
  walletUsdValue,
} from './position-valuation';
import { trackedPositionAddresses, type DashboardSnapshot, type PairMarketSnapshot, type TrackedWalletSnapshot } from './rpc';
import { scoreWalletTiers, type WalletTierInput, type WalletTierScore } from './tier-score';
import type { WalletUptimeStats } from './uptime';

interface PortfolioSummary {
  valueUsd: number;
  pendingAero: number;
  pendingAeroUsd: number;
  emissionAprPct?: number;
  feeAprPct?: number;
  holdVsLpPct?: number;
  outOfRange: boolean;
}

interface CompetitorSummary extends PortfolioSummary {
  wallet: TrackedWalletSnapshot;
  walletUsd: number;
  totalUsd: number;
  lfiExposurePct: number;
  lpCount: number;
  aprPct?: number;
  lfiSidePct?: number;
  usdcSidePct?: number;
  lowerHeadroomPct?: number;
  upperHeadroomPct?: number;
}

function numberFormat(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function compactUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

function signedPct(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function pctClass(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'positive' : 'negative';
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

function durationFormat(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function positionsForWallet(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot) {
  const addresses = new Set(trackedPositionAddresses(wallet).map((address) => address.toLowerCase()));
  return snapshot.positions.filter((position) => {
    if (position.liveError) return false;
    if (position.depositor !== undefined && addresses.has(position.depositor.toLowerCase())) return true;
    if (position.owner !== undefined && addresses.has(position.owner.toLowerCase())) return true;
    return false;
  });
}

function summarizePositions(snapshot: DashboardSnapshot, positions: typeof snapshot.positions, volatilityPct: number): PortfolioSummary {
  const active = positions.filter((position) => !position.liveError && position.liquidity !== undefined && position.liquidity > 0n);
  const valuations = active.map((position) => {
    const valuation = positionValuation(position, snapshot);
    const status = position.tickLower !== undefined && position.tickUpper !== undefined
      ? rangeStatus(snapshot.pool.currentTick, position.tickLower, position.tickUpper)
      : undefined;
    return { position, valuation, status };
  });
  const valueUsd = valuations.reduce((sum, item) => sum + (item.valuation.usd?.totalUsd ?? 0), 0);
  const pendingAero = active.reduce((sum, position) => sum + rawToDecimal(position.earnedAero ?? 0n, 18), 0);
  const pendingAeroUsd = valuations.reduce((sum, item) => sum + (item.valuation.pendingAeroUsd ?? 0), 0);
  const emissionApr = weightedAverage(valuations.map((item) => ({
    value: item.valuation.aprPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const holdVsLp = weightedAverage(valuations.map((item) => ({
    value: item.valuation.holdVsLpPct ?? item.valuation.fullRangeIlPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const inRange = valuations.some((item) => item.status?.state === 'IN_RANGE');
  const feeApr = active.length > 0
    ? inRange
      ? estimatedFeeAprPct(snapshot.market.managedPair?.volume?.h24, poolFeePct(snapshot), snapshot.market.managedPair?.liquidityUsd) ?? 0
      : 0
    : undefined;
  const outOfRange = valuations.some((item) => item.status && item.status.state !== 'IN_RANGE');

  return {
    valueUsd,
    pendingAero,
    pendingAeroUsd,
    emissionAprPct: emissionApr,
    feeAprPct: feeApr,
    holdVsLpPct: holdVsLp,
    outOfRange,
  };
}

function summarizeCompetitor(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot, volatilityPct: number): CompetitorSummary {
  const positions = positionsForWallet(snapshot, wallet);
  const positiveLiquidityPositions = positions.filter((position) => position.liquidity !== undefined && position.liquidity > 0n);
  const lp = summarizePositions(snapshot, positiveLiquidityPositions, volatilityPct);
  const walletUsd = walletUsdValue(snapshot, wallet.balances);
  const lfiExposure = walletLfiExposurePct(snapshot, wallet.balances);
  const valuations = positiveLiquidityPositions.map((position) => ({
    position,
    valuation: positionValuation(position, snapshot),
    status: position.tickLower !== undefined && position.tickUpper !== undefined
      ? rangeStatus(snapshot.pool.currentTick, position.tickLower, position.tickUpper)
      : undefined,
  }));
  const lfiSidePct = weightedAverage(valuations.map((item) => ({
    value: item.valuation.usd?.token0Pct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const usdcSidePct = weightedAverage(valuations.map((item) => ({
    value: item.valuation.usd?.token1Pct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const lowerHeadroomPct = weightedAverage(valuations.map((item) => ({
    value: item.status?.lowerHeadroomPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const upperHeadroomPct = weightedAverage(valuations.map((item) => ({
    value: item.status?.upperHeadroomPct,
    weight: item.valuation.usd?.totalUsd,
  })));
  const aprPct = lp.emissionAprPct;

  return {
    ...lp,
    wallet,
    walletUsd,
    totalUsd: walletUsd + lp.valueUsd,
    lfiExposurePct: lfiExposure,
    lpCount: positiveLiquidityPositions.length,
    aprPct,
    lfiSidePct,
    usdcSidePct,
    lowerHeadroomPct,
    upperHeadroomPct,
  };
}

function currentEmissionAprPct(snapshot: DashboardSnapshot): number | undefined {
  const active = snapshot.positions.filter((position) => !position.liveError && position.liquidity !== undefined && position.liquidity > 0n);
  const activeEmissionApr = weightedAverage(active.map((position) => {
    const valuation = positionValuation(position, snapshot);
    return { value: valuation.aprPct, weight: valuation.usd?.totalUsd };
  }));
  if (activeEmissionApr !== undefined) return activeEmissionApr;
  const stakedTvl = stakedTvlUsd(snapshot);
  if (!snapshot.market.aeroUsd || stakedTvl === undefined || stakedTvl <= 0) return undefined;
  const annualEmissionUsd = rawToDecimal(snapshot.pool.rewardRate, 18) * 31_536_000 * snapshot.market.aeroUsd;
  return (annualEmissionUsd / stakedTvl) * 100;
}

function livePoolTvlUsd(snapshot: DashboardSnapshot): number | undefined {
  const reserveTvl = poolReserveBreakdown(snapshot).totalUsd;
  if (Number.isFinite(reserveTvl) && reserveTvl > 0) return reserveTvl;
  return snapshot.market.managedPair?.liquidityUsd;
}

function stakedTvlUsd(snapshot: DashboardSnapshot): number | undefined {
  const poolTvl = livePoolTvlUsd(snapshot);
  if (poolTvl === undefined || snapshot.pool.liquidity <= 0n) return undefined;
  return poolTvl * (Number(snapshot.pool.stakedLiquidity) / Number(snapshot.pool.liquidity));
}

function fallbackWindowChange(pair: PairMarketSnapshot | undefined, hours: number): number | undefined {
  const key = hours === 1 ? 'h1' : hours === 6 ? 'h6' : hours === 24 ? 'h24' : undefined;
  return key ? pair?.priceChange?.[key] : undefined;
}

function renderPriceWindows(candles: GeckoCandle[], fallbackPair?: PairMarketSnapshot): string {
  const changes = priceWindowChanges(candles, PRICE_CHANGE_WINDOWS);
  return `
    <div class="analytics-window-grid">
      ${changes.map((change) => {
        const fallback = fallbackWindowChange(fallbackPair, change.hours);
        const changePct = change.changePct ?? fallback;
        return `
          <div class="analytics-cell">
            <span>${change.hours}h</span>
            <strong class="${pctClass(changePct)}">${signedPct(changePct)}</strong>
            <small>${change.fromPrice ? `${formatUsd(change.fromPrice, 8)} -> ${formatUsd(change.toPrice, 8)}` : fallback === undefined ? 'n/a' : 'Dexscreener'}</small>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPoolComposition(snapshot: DashboardSnapshot): string {
  const pair = snapshot.market.managedPair;
  const reserves = poolReserveBreakdown(snapshot);
  const feeApr = estimatedFeeAprPct(pair?.volume?.h24, poolFeePct(snapshot), pair?.liquidityUsd);
  return `
    <section class="analytics-card">
      <header>
        <span>Managed pool</span>
        <strong>${pair?.baseSymbol ?? 'LFI'}/${pair?.quoteSymbol ?? 'USDC'}</strong>
      </header>
      <div class="analytics-two-col">
        <div><span>LFI side</span><strong>${compactUsd(reserves.lfiUsd)}</strong><small>${numberFormat(reserves.lfi, 2)} LFI</small></div>
        <div><span>USDC side</span><strong>${compactUsd(reserves.usdcUsd)}</strong><small>${numberFormat(reserves.usdc, 2)} USDC</small></div>
      </div>
      <div class="analytics-kv">
        <span>Pool token balances <b>${compactUsd(reserves.totalUsd)}</b></span>
        <span>Rewarded TVL estimate <b>${compactUsd(stakedTvlUsd(snapshot))}</b></span>
        <span>24h volume <b>${compactUsd(pair?.volume?.h24)}</b></span>
        <span>Estimated fee APR <b>${feeApr === undefined ? 'n/a' : percentFormat(feeApr, 2)}</b></span>
      </div>
    </section>
  `;
}

function renderRangeSuggestion(snapshot: DashboardSnapshot, candles: GeckoCandle[]): string {
  const primary = snapshot.positions.find((position) => !position.liveError && position.tickSpacing !== undefined);
  const emissionAprPct = currentEmissionAprPct(snapshot);
  const heatmap = volatilityHeatmap(candles);
  const suggestion = suggestedLpRangeFromCandles({
    candles,
    currentTick: snapshot.pool.currentTick,
    tickSpacing: primary?.tickSpacing ?? 200,
    token0Decimals: 18,
    token1Decimals: 6,
    emissionAprPct,
    emissionModel: snapshot.market.aeroUsd
      ? {
        rewardRateRaw: snapshot.pool.rewardRate,
        rewardTokenUsd: snapshot.market.aeroUsd,
        totalStakedLiquidity: snapshot.pool.stakedLiquidity,
        rewardTokenDecimals: 18,
      }
      : undefined,
    heatmapRegimeMultiplier: heatmap.currentRegimeMultiplier,
  });
  const currentHeatmapVol = heatmap.currentCell && heatmap.currentCell.sampleCount > 0
    ? percentFormat(heatmap.currentCell.volatilityPct, 2)
    : 'n/a';
  return `
    <section class="analytics-card">
      <header>
        <span>Optimal LP width</span>
        <strong>${percentFormat(suggestion.totalWidthPct, 1)}</strong>
      </header>
      <div class="analytics-two-col">
        <div><span>Lower</span><strong>${tickLabel(suggestion.lowerTick)}</strong><small>${formatUsd(suggestion.lowerPrice, 8)}</small></div>
        <div><span>Upper</span><strong>${tickLabel(suggestion.upperTick)}</strong><small>${formatUsd(suggestion.upperPrice, 8)}</small></div>
      </div>
      <div class="analytics-kv">
        <span>Recommended band <b>${formatUsd(suggestion.lowerPrice, 8)} - ${formatUsd(suggestion.upperPrice, 8)}</b></span>
        <span>Width each side <b>${percentFormat(suggestion.halfWidthPct, 1)}</b></span>
        <span>24h realized volatility <b>${percentFormat(suggestion.realizedVolatilityPct, 2)}</b></span>
        <span>48h observed move <b>${percentFormat(suggestion.observedMovePct, 2)}</b></span>
        <span>Weekday/hour volatility regime <b>${heatmap.sampleCount > 0 ? `${numberFormat(suggestion.heatmapRegimeMultiplier, 2)}x` : 'n/a'}</b></span>
        <span>Current heatmap volatility <b>${currentHeatmapVol}</b></span>
        <span>Current reward APR input <b>${suggestion.emissionAprPct === undefined ? 'n/a' : percentFormat(suggestion.emissionAprPct, 2)}</b></span>
        <span>Modeled reward APR <b>${suggestion.modeledEmissionAprPct === undefined ? 'n/a' : percentFormat(suggestion.modeledEmissionAprPct, 2)}</b></span>
        <span>Capital efficiency <b>${suggestion.capitalEfficiencyPct === undefined ? 'n/a' : percentFormat(suggestion.capitalEfficiencyPct, 1)}</b></span>
        <span>Reward width adjustment <b>-${percentFormat(suggestion.emissionTighteningPct, 1)}</b></span>
      </div>
    </section>
  `;
}

function renderVolatilityHeatmap(candles: GeckoCandle[]): string {
  const heatmap = volatilityHeatmap(candles);
  const hourLabels = Array.from({ length: 24 }, (_, hour) => `
    <span>${hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}</span>
  `).join('');
  const currentCell = heatmap.currentCell && heatmap.currentCell.sampleCount > 0
    ? `${heatmap.currentCell.dayLabel} ${String(heatmap.currentCell.hour).padStart(2, '0')}:00 UTC`
    : 'waiting for history';
  const subtitle = heatmap.sampleCount > 0
    ? `${numberFormat(heatmap.currentRegimeMultiplier, 2)}x current regime / ${numberFormat(heatmap.sampleCount, 0)} samples`
    : 'waiting for hourly candles';

  return `
    <section class="analytics-card analytics-wide heatmap-card">
      <header>
        <span>LFI volatility heatmap</span>
        <strong>${subtitle}</strong>
      </header>
      <div class="heatmap-shell" role="img" aria-label="LFI hourly volatility heatmap by UTC weekday and hour">
        <div class="heatmap-hour-axis" aria-hidden="true">
          <span></span>
          <div>${hourLabels}</div>
        </div>
        ${VOLATILITY_HEATMAP_DAYS.map((dayLabel, dayIndex) => `
          <div class="heatmap-row">
            <span class="heatmap-day">${dayLabel}</span>
            <div class="heatmap-cells">
              ${heatmap.cells
                .filter((cell) => cell.dayIndex === dayIndex)
                .map((cell) => {
                  const label = `${cell.dayLabel} ${String(cell.hour).padStart(2, '0')}:00 UTC`;
                  const sampleText = `${cell.sampleCount} sample${cell.sampleCount === 1 ? '' : 's'}`;
                  const tooltip = cell.sampleCount > 0
                    ? `${label}\n${percentFormat(cell.volatilityPct, 2)} average hourly volatility\n${sampleText}${cell.isCurrent ? '\nCurrent slot' : ''}`
                    : `${label}\nNo candle samples yet`;
                  const ariaLabel = cell.sampleCount > 0
                    ? `${label}: ${percentFormat(cell.volatilityPct, 2)} average hourly volatility from ${cell.sampleCount} sample${cell.sampleCount === 1 ? '' : 's'}`
                    : `${label}: no sample`;
                  return `
                    <span
                      class="heatmap-cell${cell.isCurrent ? ' current' : ''}${cell.sampleCount === 0 ? ' empty' : ''}"
                      style="--heat: ${(cell.normalized * 100).toFixed(0)}%;"
                      data-tooltip="${escapeAttribute(tooltip)}"
                      aria-label="${escapeAttribute(ariaLabel)}"
                    ></span>
                  `;
                }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="heatmap-footer">
        <span>Current slot <b>${currentCell}</b></span>
        <span>Average hourly volatility <b>${percentFormat(heatmap.averageVolatilityPct, 2)}</b></span>
        <span class="heatmap-legend"><i></i><b>Low</b><em></em><b>High</b></span>
      </div>
    </section>
  `;
}

function fallbackUptime(summary: CompetitorSummary, nowMs: number): WalletUptimeStats {
  const lastState = summary.valueUsd <= 0 ? 'noPosition' : summary.outOfRange ? 'outOfRange' : 'inRange';
  return {
    firstSeenMs: nowMs,
    lastSeenMs: nowMs,
    lastState,
    inRangeMs: 0,
    outOfRangeMs: 0,
    noPositionMs: 0,
  };
}

function competitorTierInput(
  summary: CompetitorSummary,
  uptimeStatsByWallet: Map<string, WalletUptimeStats> | undefined,
  volatilityPct: number,
  nowMs: number,
): WalletTierInput {
  const id = summary.wallet.address.toLowerCase();
  return {
    id,
    uptime: uptimeStatsByWallet?.get(id) ?? fallbackUptime(summary, nowMs),
    emissionAprPct: summary.emissionAprPct,
    feeAprPct: summary.feeAprPct,
    volatilityPct,
    holdVsLpPct: summary.holdVsLpPct,
    pendingRewardsUsd: summary.pendingAeroUsd,
    lpUsd: summary.valueUsd,
    outOfRange: summary.outOfRange,
  };
}

function tierLine(score: WalletTierScore): string {
  return `<span class="tier-score-line ${score.tierClass}"><b>${score.tier}</b><em>${numberFormat(score.score, 1)}</em></span>`;
}

function winnerLabel(agent: WalletTierScore, human: WalletTierScore): string {
  if (agent.score === human.score) return 'Even';
  return agent.score > human.score ? 'AI agent leading' : 'Manual human leading';
}

function renderProfitability(agent: CompetitorSummary, human: CompetitorSummary, agentScore: WalletTierScore, humanScore: WalletTierScore): string {
  const relative = agentScore.score > 0 ? (humanScore.score / agentScore.score) * 100 : humanScore.score > 0 ? Infinity : 0;
  return `
    <section class="analytics-card analytics-wide">
      <header>
        <span>Manual human vs AI agent</span>
        <strong>${winnerLabel(agentScore, humanScore)}</strong>
      </header>
      <div class="analytics-score-grid compact">
        <div>
          <span>AI tier</span>
          <strong>${tierLine(agentScore)}</strong>
          <small>${percentFormat(agentScore.uptimePct, 1)} uptime / ${durationFormat(agentScore.trackedMs)} history</small>
        </div>
        <div>
          <span>Human tier</span>
          <strong>${tierLine(humanScore)}</strong>
          <small>${percentFormat(humanScore.uptimePct, 1)} uptime / ${durationFormat(humanScore.trackedMs)} history</small>
        </div>
        <div>
          <span>Score spread</span>
          <strong>${numberFormat(Math.abs(agentScore.score - humanScore.score), 1)}</strong>
          <small>${humanScore.score === 0 && agentScore.score > 0 ? 'manual wallet has no confirmed active LP' : `human/agent ratio ${Number.isFinite(relative) ? numberFormat(relative, 1) : 'n/a'}`}</small>
        </div>
        <div>
          <span>Agent APR stack</span>
          <strong>${agent.aprPct === undefined ? 'n/a' : percentFormat(agent.aprPct, 2)}</strong>
          <small>rewards ${agent.emissionAprPct === undefined ? 'n/a' : percentFormat(agent.emissionAprPct, 2)} / fee est ${agent.feeAprPct === undefined ? 'n/a' : percentFormat(agent.feeAprPct, 2)}</small>
        </div>
        <div>
          <span>Manual APR stack</span>
          <strong>${human.aprPct === undefined ? 'n/a' : percentFormat(human.aprPct, 2)}</strong>
          <small>rewards ${human.emissionAprPct === undefined ? 'n/a' : percentFormat(human.emissionAprPct, 2)} / fee est ${human.feeAprPct === undefined ? 'n/a' : percentFormat(human.feeAprPct, 2)}</small>
        </div>
        <div>
          <span>Tier basis</span>
          <strong>${numberFormat(agentScore.yieldScore, 1)} / ${numberFormat(humanScore.yieldScore, 1)}</strong>
          <small>AI/human yield score, uptime weighted first</small>
        </div>
      </div>
    </section>
  `;
}

function renderContent(
  snapshot: DashboardSnapshot,
  managedCandles: GeckoCandle[],
  referenceCandles: GeckoCandle[],
  uptimeStatsByWallet?: Map<string, WalletUptimeStats>,
): string {
  const candlesForWindows = referenceCandles.length > 0 ? referenceCandles : managedCandles;
  const candlesForLp = managedCandles.length > 0 ? managedCandles : referenceCandles;
  const volatility = realizedVolatilityPct(candlesForLp, 24);
  const agentWallet = snapshot.trackedWallets.find((wallet) => wallet.role === 'agent') ?? snapshot.trackedWallets[0];
  const humanWallet = snapshot.trackedWallets.find((wallet) => wallet.role === 'human') ?? snapshot.trackedWallets[1] ?? snapshot.trackedWallets[0];
  const agent = summarizeCompetitor(snapshot, agentWallet, volatility);
  const human = summarizeCompetitor(snapshot, humanWallet, volatility);
  const tierScores = new Map(scoreWalletTiers([
    competitorTierInput(agent, uptimeStatsByWallet, volatility, snapshot.loadedAt.getTime()),
    competitorTierInput(human, uptimeStatsByWallet, volatility, snapshot.loadedAt.getTime()),
  ]).map((score) => [score.id, score]));
  const agentScore = tierScores.get(agent.wallet.address.toLowerCase())!;
  const humanScore = tierScores.get(human.wallet.address.toLowerCase())!;

  return `
    <div class="analytics-head">
      <div>
        <p class="eyebrow">Bottom analytics</p>
        <h2>LFI risk, emissions, and tier score</h2>
      </div>
      <div class="analytics-price">
        <span>LFI</span>
        <strong>${formatUsd(lfiUsd(snapshot), 8)}</strong>
      </div>
    </div>
    <section class="analytics-card analytics-wide">
      <header>
        <span>Critical price windows</span>
        <strong>${snapshot.market.referencePair?.dexId ?? 'reference'} ${snapshot.market.referencePair?.baseSymbol ?? 'LFI'}/${snapshot.market.referencePair?.quoteSymbol ?? 'WETH'}</strong>
      </header>
      ${renderPriceWindows(candlesForWindows, snapshot.market.referencePair)}
    </section>
    <div class="analytics-grid">
      ${renderPoolComposition(snapshot)}
      ${renderRangeSuggestion(snapshot, candlesForLp)}
      ${renderProfitability(agent, human, agentScore, humanScore)}
      ${renderVolatilityHeatmap(candlesForLp)}
    </div>
  `;
}

export async function renderBottomAnalytics(
  snapshot: DashboardSnapshot,
  mount: HTMLElement,
  preloadedManagedCandles: GeckoCandle[] = [],
  uptimeStatsByWallet?: Map<string, WalletUptimeStats>,
): Promise<void> {
  mount.innerHTML = `
    <div class="analytics-loading">
      <div class="loader small"></div>
      <span>Loading LFI analytics</span>
    </div>
  `;

  const [managed, reference] = await Promise.allSettled([
    preloadedManagedCandles.length > 0
      ? Promise.resolve(preloadedManagedCandles)
      : fetchGeckoPoolOhlcv({ poolAddress: CONTRACTS.pool, timeframe: 'hour', aggregate: 1, limit: HISTORICAL_HOURLY_CANDLE_LIMIT }),
    fetchGeckoPoolOhlcv({ poolAddress: CONTRACTS.lfiReferencePool, timeframe: 'hour', aggregate: 1, limit: 49 }),
  ]);
  const managedCandles = managed.status === 'fulfilled' ? managed.value : [];
  const referenceCandles = reference.status === 'fulfilled' ? reference.value : [];
  mount.innerHTML = renderContent(snapshot, managedCandles, referenceCandles, uptimeStatsByWallet);
}
