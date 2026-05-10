import {
  estimatedFeeAprPct,
  formatUsd,
  percentFormat,
  profitabilityIndex,
  rangeStatus,
  rawToDecimal,
  tickLabel,
} from './aero-math';
import {
  PRICE_CHANGE_WINDOWS,
  priceWindowChanges,
  realizedVolatilityPct,
  suggestedLpRangeFromCandles,
} from './analytics';
import { CONTRACTS } from './config';
import { fetchGeckoPoolOhlcv, type GeckoCandle } from './gecko';
import {
  lfiUsd,
  positionValuation,
  walletLfiExposurePct,
  walletUsdValue,
} from './position-valuation';
import type { DashboardSnapshot, PairMarketSnapshot, TrackedWalletSnapshot } from './rpc';

interface PortfolioSummary {
  valueUsd: number;
  pendingAero: number;
  pendingAeroUsd: number;
  emissionAprPct?: number;
  feeAprPct?: number;
  holdVsLpPct?: number;
  outOfRange: boolean;
  index: number;
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

function scoreFormat(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return numberFormat(value, 1);
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

function pairSideUsd(pair: PairMarketSnapshot | undefined): { baseUsd?: number; quoteUsd?: number } {
  if (!pair?.liquidityBase || !pair.priceUsd) return {};
  const baseUsd = pair.liquidityBase * pair.priceUsd;
  const quoteUsd = pair.quoteSymbol?.toUpperCase() === 'USDC' && pair.liquidityQuote
    ? pair.liquidityQuote
    : pair.liquidityUsd && Number.isFinite(pair.liquidityUsd)
      ? Math.max(0, pair.liquidityUsd - baseUsd)
      : undefined;
  return { baseUsd, quoteUsd };
}

function positionsForWallet(snapshot: DashboardSnapshot, wallet: TrackedWalletSnapshot) {
  const address = wallet.address.toLowerCase();
  return snapshot.positions.filter((position) => {
    if (position.liveError) return false;
    if (position.depositor?.toLowerCase() === address) return true;
    if (position.owner?.toLowerCase() === address) return true;
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
    index: profitabilityIndex({
      emissionAprPct: emissionApr,
      feeAprPct: feeApr,
      volatilityPct,
      impermanentLossPct: holdVsLp,
      pendingRewardsUsd: pendingAeroUsd,
      portfolioUsd: valueUsd,
      outOfRange,
    }),
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
  const aprPct = lp.emissionAprPct !== undefined || lp.feeAprPct !== undefined
    ? (lp.emissionAprPct ?? 0) + (lp.feeAprPct ?? 0)
    : undefined;

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
  if (!snapshot.market.aeroUsd || !snapshot.market.managedPair?.liquidityUsd || snapshot.market.managedPair.liquidityUsd <= 0) return undefined;
  const annualEmissionUsd = rawToDecimal(snapshot.pool.rewardRate, 18) * 31_536_000 * snapshot.market.aeroUsd;
  return (annualEmissionUsd / snapshot.market.managedPair.liquidityUsd) * 100;
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
  const sides = pairSideUsd(pair);
  const feeApr = estimatedFeeAprPct(pair?.volume?.h24, poolFeePct(snapshot), pair?.liquidityUsd);
  return `
    <section class="analytics-card">
      <header>
        <span>Managed pool</span>
        <strong>${pair?.baseSymbol ?? 'LFI'}/${pair?.quoteSymbol ?? 'USDC'}</strong>
      </header>
      <div class="analytics-two-col">
        <div><span>${pair?.baseSymbol ?? 'LFI'} side</span><strong>${compactUsd(sides.baseUsd)}</strong><small>${numberFormat(pair?.liquidityBase, 2)} ${pair?.baseSymbol ?? 'LFI'}</small></div>
        <div><span>${pair?.quoteSymbol ?? 'USDC'} side</span><strong>${compactUsd(sides.quoteUsd)}</strong><small>${numberFormat(pair?.liquidityQuote, 2)} ${pair?.quoteSymbol ?? 'USDC'}</small></div>
      </div>
      <div class="analytics-kv">
        <span>Total liquidity <b>${compactUsd(pair?.liquidityUsd)}</b></span>
        <span>24h volume <b>${compactUsd(pair?.volume?.h24)}</b></span>
        <span>Estimated fee APR <b>${feeApr === undefined ? 'n/a' : percentFormat(feeApr, 2)}</b></span>
      </div>
    </section>
  `;
}

function renderRangeSuggestion(snapshot: DashboardSnapshot, candles: GeckoCandle[]): string {
  const primary = snapshot.positions.find((position) => !position.liveError && position.tickSpacing !== undefined);
  const emissionAprPct = currentEmissionAprPct(snapshot);
  const suggestion = suggestedLpRangeFromCandles({
    candles,
    currentTick: snapshot.pool.currentTick,
    tickSpacing: primary?.tickSpacing ?? 200,
    token0Decimals: 18,
    token1Decimals: 6,
    emissionAprPct,
  });
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
        <span>Emission APR input <b>${suggestion.emissionAprPct === undefined ? 'n/a' : percentFormat(suggestion.emissionAprPct, 2)}</b></span>
        <span>Emission width adjustment <b>-${percentFormat(suggestion.emissionTighteningPct, 1)}</b></span>
      </div>
    </section>
  `;
}

function winnerLabel(agent: CompetitorSummary, human: CompetitorSummary): string {
  if (agent.index === human.index) return 'Even';
  return agent.index > human.index ? 'AI agent leading' : 'Manual human leading';
}

function renderProfitability(agent: CompetitorSummary, human: CompetitorSummary): string {
  const relative = agent.index > 0 ? (human.index / agent.index) * 100 : human.index > 0 ? Infinity : 0;
  return `
    <section class="analytics-card analytics-wide">
      <header>
        <span>Manual human vs AI agent</span>
        <strong>${winnerLabel(agent, human)}</strong>
      </header>
      <div class="analytics-score-grid compact">
        <div>
          <span>AI index</span>
          <strong>${scoreFormat(agent.index)}</strong>
          <small>${formatUsd(agent.valueUsd)} LP / ${agent.aprPct === undefined ? 'n/a' : percentFormat(agent.aprPct, 2)} APR</small>
        </div>
        <div>
          <span>Human index</span>
          <strong>${scoreFormat(human.index)}</strong>
          <small>${formatUsd(human.valueUsd)} LP / ${human.aprPct === undefined ? 'n/a' : percentFormat(human.aprPct, 2)} APR</small>
        </div>
        <div>
          <span>Score spread</span>
          <strong>${scoreFormat(Math.abs(agent.index - human.index))}</strong>
          <small>${human.index === 0 && agent.index > 0 ? 'manual wallet has no confirmed active LP' : `human/agent ratio ${Number.isFinite(relative) ? numberFormat(relative, 1) : 'n/a'}`}</small>
        </div>
        <div>
          <span>Agent APR stack</span>
          <strong>${agent.aprPct === undefined ? 'n/a' : percentFormat(agent.aprPct, 2)}</strong>
          <small>emissions ${agent.emissionAprPct === undefined ? 'n/a' : percentFormat(agent.emissionAprPct, 2)} / fees ${agent.feeAprPct === undefined ? 'n/a' : percentFormat(agent.feeAprPct, 2)}</small>
        </div>
        <div>
          <span>Manual APR stack</span>
          <strong>${human.aprPct === undefined ? 'n/a' : percentFormat(human.aprPct, 2)}</strong>
          <small>emissions ${human.emissionAprPct === undefined ? 'n/a' : percentFormat(human.emissionAprPct, 2)} / fees ${human.feeAprPct === undefined ? 'n/a' : percentFormat(human.feeAprPct, 2)}</small>
        </div>
        <div>
          <span>Manual wallet LFI exposure</span>
          <strong>${percentFormat(human.lfiExposurePct, 1)}</strong>
          <small>${formatUsd(human.walletUsd)} tracked wallet value</small>
        </div>
      </div>
    </section>
  `;
}

function renderContent(snapshot: DashboardSnapshot, managedCandles: GeckoCandle[], referenceCandles: GeckoCandle[]): string {
  const candlesForWindows = referenceCandles.length > 0 ? referenceCandles : managedCandles;
  const candlesForLp = managedCandles.length > 0 ? managedCandles : referenceCandles;
  const volatility = realizedVolatilityPct(candlesForLp, 24);
  const agentWallet = snapshot.trackedWallets.find((wallet) => wallet.role === 'agent') ?? snapshot.trackedWallets[0];
  const humanWallet = snapshot.trackedWallets.find((wallet) => wallet.role === 'human') ?? snapshot.trackedWallets[1] ?? snapshot.trackedWallets[0];
  const agent = summarizeCompetitor(snapshot, agentWallet, volatility);
  const human = summarizeCompetitor(snapshot, humanWallet, volatility);

  return `
    <div class="analytics-head">
      <div>
        <p class="eyebrow">Bottom analytics</p>
        <h2>LFI risk, emissions, and wallet index</h2>
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
      ${renderProfitability(agent, human)}
    </div>
  `;
}

export async function renderBottomAnalytics(snapshot: DashboardSnapshot, mount: HTMLElement, preloadedManagedCandles: GeckoCandle[] = []): Promise<void> {
  mount.innerHTML = `
    <div class="analytics-loading">
      <div class="loader small"></div>
      <span>Loading LFI analytics</span>
    </div>
  `;

  const [managed, reference] = await Promise.allSettled([
    preloadedManagedCandles.length > 0
      ? Promise.resolve(preloadedManagedCandles)
      : fetchGeckoPoolOhlcv({ poolAddress: CONTRACTS.pool, timeframe: 'hour', aggregate: 1, limit: 49 }),
    fetchGeckoPoolOhlcv({ poolAddress: CONTRACTS.lfiReferencePool, timeframe: 'hour', aggregate: 1, limit: 49 }),
  ]);
  const managedCandles = managed.status === 'fulfilled' ? managed.value : [];
  const referenceCandles = reference.status === 'fulfilled' ? reference.value : [];
  mount.innerHTML = renderContent(snapshot, managedCandles, referenceCandles);
}
