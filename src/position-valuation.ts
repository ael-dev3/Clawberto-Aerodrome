import type { Address } from 'viem';

import {
  emissionAprPct,
  estimatePositionTokenAmounts,
  holdVsLpPct,
  impermanentLossPct,
  rawToDecimal,
  tickToAdjustedPrice,
  usdBreakdown,
  type PositionAmountEstimate,
  type UsdBreakdown,
} from './aero-math';
import { CONTRACTS, TOKEN_META } from './config';
import { tokenDecimals, type DashboardSnapshot, type LivePosition } from './rpc';

export interface PositionValuation {
  amounts?: PositionAmountEstimate;
  usd?: UsdBreakdown;
  aprPct?: number;
  pendingAeroUsd?: number;
  owedUsd?: number;
  depositedHoldUsd?: number;
  holdVsLpPct?: number;
  fullRangeIlPct?: number;
}

export interface PoolReserveBreakdown {
  lfi: number;
  usdc: number;
  lfiUsd: number;
  usdcUsd: number;
  totalUsd: number;
}

export function tokenSymbol(address: string | undefined, fallback: string): string {
  if (!address) return fallback;
  return Object.entries(TOKEN_META).find(([knownAddress]) => knownAddress.toLowerCase() === address.toLowerCase())?.[1].symbol ?? fallback;
}

export function lfiUsd(snapshot: DashboardSnapshot): number {
  return tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
}

export function tokenUsd(address: Address | undefined, snapshot: DashboardSnapshot): number {
  const symbol = tokenSymbol(address, 'token');
  if (symbol === 'USDC') return 1;
  if (symbol === 'AERO') return snapshot.market.aeroUsd ?? 0;
  if (symbol === 'LFI') return lfiUsd(snapshot);
  return 0;
}

export function poolReserveBreakdown(snapshot: DashboardSnapshot): PoolReserveBreakdown {
  const lfi = rawToDecimal(snapshot.pool.lfiBalance, 18);
  const usdc = rawToDecimal(snapshot.pool.usdcBalance, 6);
  const lfiValue = lfi * lfiUsd(snapshot);
  return {
    lfi,
    usdc,
    lfiUsd: lfiValue,
    usdcUsd: usdc,
    totalUsd: lfiValue + usdc,
  };
}

function owedUsd(position: LivePosition, snapshot: DashboardSnapshot): number | undefined {
  if (position.tokensOwed0 === undefined || position.tokensOwed1 === undefined) return undefined;
  const token0 = rawToDecimal(position.tokensOwed0, tokenDecimals(position.token0));
  const token1 = rawToDecimal(position.tokensOwed1, tokenDecimals(position.token1));
  return token0 * tokenUsd(position.token0, snapshot) + token1 * tokenUsd(position.token1, snapshot);
}

function depositedHoldUsd(position: LivePosition, snapshot: DashboardSnapshot): number | undefined {
  if (!position.deposited) return undefined;
  return rawToDecimal(position.deposited.lfiRaw, 18) * lfiUsd(snapshot) + rawToDecimal(position.deposited.usdcRaw, 6);
}

function entryPrice(position: LivePosition): number | undefined {
  if (!position.deposited) return undefined;
  const lfi = rawToDecimal(position.deposited.lfiRaw, 18);
  const usdc = rawToDecimal(position.deposited.usdcRaw, 6);
  return lfi > 0 ? usdc / lfi : undefined;
}

export function positionValuation(position: LivePosition, snapshot: DashboardSnapshot): PositionValuation {
  if (position.liquidity === undefined || position.tickLower === undefined || position.tickUpper === undefined) return {};

  const token0Decimals = tokenDecimals(position.token0);
  const token1Decimals = tokenDecimals(position.token1);
  const amounts = estimatePositionTokenAmounts({
    liquidity: position.liquidity,
    currentTick: snapshot.pool.currentTick,
    lowerTick: position.tickLower,
    upperTick: position.tickUpper,
    token0Decimals,
    token1Decimals,
  });
  const usd = usdBreakdown(amounts, tokenUsd(position.token0, snapshot), tokenUsd(position.token1, snapshot));
  const aprPct = snapshot.market.aeroUsd && position.staked
    ? emissionAprPct({
      rewardRateRaw: snapshot.pool.rewardRate,
      rewardTokenDecimals: 18,
      rewardTokenUsd: snapshot.market.aeroUsd,
      positionLiquidity: position.liquidity,
      totalStakedLiquidity: snapshot.pool.stakedLiquidity,
      positionUsd: usd.totalUsd,
    })
    : undefined;
  const pendingAeroUsd = snapshot.market.aeroUsd && position.staked && position.earnedAero !== undefined
    ? rawToDecimal(position.earnedAero, 18) * snapshot.market.aeroUsd
    : undefined;
  const feesUsd = owedUsd(position, snapshot);
  const holdUsd = depositedHoldUsd(position, snapshot);
  const lpWithRewardsUsd = usd.totalUsd + (feesUsd ?? 0) + (pendingAeroUsd ?? 0);
  const initialPrice = entryPrice(position);
  const fullRangeIlPct = initialPrice ? impermanentLossPct(lfiUsd(snapshot) / initialPrice) : undefined;

  return {
    amounts,
    usd,
    aprPct,
    pendingAeroUsd,
    owedUsd: feesUsd,
    depositedHoldUsd: holdUsd,
    holdVsLpPct: holdVsLpPct(lpWithRewardsUsd, holdUsd),
    fullRangeIlPct,
  };
}

export function walletUsdValue(snapshot: DashboardSnapshot, balances: { eth: bigint; lfi: bigint; usdc: bigint; aero: bigint }): number {
  return (
    rawToDecimal(balances.eth, 18) * (snapshot.market.ethUsd ?? 0) +
    rawToDecimal(balances.lfi, 18) * lfiUsd(snapshot) +
    rawToDecimal(balances.usdc, 6) +
    rawToDecimal(balances.aero, 18) * (snapshot.market.aeroUsd ?? 0)
  );
}

export function walletLfiExposurePct(snapshot: DashboardSnapshot, balances: { eth: bigint; lfi: bigint; usdc: bigint; aero: bigint }): number {
  const total = walletUsdValue(snapshot, balances);
  if (total <= 0) return 0;
  return (rawToDecimal(balances.lfi, 18) * lfiUsd(snapshot) / total) * 100;
}

export function isLfiUsdcPosition(position: LivePosition): boolean {
  const token0 = position.token0?.toLowerCase();
  const token1 = position.token1?.toLowerCase();
  return (
    (token0 === CONTRACTS.lfi.toLowerCase() && token1 === CONTRACTS.usdc.toLowerCase()) ||
    (token0 === CONTRACTS.usdc.toLowerCase() && token1 === CONTRACTS.lfi.toLowerCase())
  );
}
