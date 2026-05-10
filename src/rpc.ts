import { createPublicClient, fallback, http, type Address } from 'viem';
import { base } from 'viem/chains';

import { erc20Abi, gaugeAbi, nftManagerAbi, poolAbi } from './aero-abis';
import { CONTRACTS, RPC_ENDPOINTS, TOKEN_META, WALLET_ADDRESS } from './config';
import { managedPositions, type ManagedPositionRecord } from './positions';

const AERO_DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${CONTRACTS.aero}`;
const MARKET_TIMEOUT_MS = 5_000;

export const client = createPublicClient({
  chain: base,
  transport: fallback(RPC_ENDPOINTS.map((url) => http(url, { timeout: 8_000 }))),
});

export interface PoolSnapshot {
  currentTick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  stakedLiquidity: bigint;
  fee: number;
  rewardRate: bigint;
  rewardsLeft: bigint;
}

export interface LivePosition extends ManagedPositionRecord {
  owner?: Address;
  token0?: Address;
  token1?: Address;
  tickSpacing?: number;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: bigint;
  tokensOwed0?: bigint;
  tokensOwed1?: bigint;
  staked?: boolean;
  earnedAero?: bigint;
  liveError?: string;
}

export interface WalletBalances {
  eth: bigint;
  lfi: bigint;
  usdc: bigint;
  aero: bigint;
}

export interface MarketSnapshot {
  aeroUsd?: number;
  aeroUsdSource: string;
  aeroUsdError?: string;
}

export interface DashboardSnapshot {
  pool: PoolSnapshot;
  positions: LivePosition[];
  walletBalances: WalletBalances;
  market: MarketSnapshot;
  loadedAt: Date;
}

interface DexscreenerPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  priceUsd?: string;
  baseToken?: { symbol?: string; address?: string };
  quoteToken?: { symbol?: string; address?: string };
}

interface DexscreenerResponse {
  pairs?: DexscreenerPair[];
}

export async function loadPoolSnapshot(): Promise<PoolSnapshot> {
  const [slot0, liquidity, stakedLiquidity, fee, rewardRate, rewardsLeft] = await Promise.all([
    client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'slot0' }),
    client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'liquidity' }),
    client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'stakedLiquidity' }),
    client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'fee' }),
    client.readContract({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'rewardRate' }),
    client.readContract({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'left' }),
  ]);

  return {
    sqrtPriceX96: slot0[0],
    currentTick: slot0[1],
    liquidity,
    stakedLiquidity,
    fee,
    rewardRate,
    rewardsLeft,
  };
}

export async function loadWalletBalances(): Promise<WalletBalances> {
  const [eth, lfi, usdc, aero] = await Promise.all([
    client.getBalance({ address: WALLET_ADDRESS }),
    client.readContract({ address: CONTRACTS.lfi, abi: erc20Abi, functionName: 'balanceOf', args: [WALLET_ADDRESS] }),
    client.readContract({ address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [WALLET_ADDRESS] }),
    client.readContract({ address: CONTRACTS.aero, abi: erc20Abi, functionName: 'balanceOf', args: [WALLET_ADDRESS] }),
  ]);
  return { eth, lfi, usdc, aero };
}

export async function loadAeroUsdPrice(): Promise<MarketSnapshot> {
  if (typeof fetch === 'undefined') {
    return { aeroUsdSource: 'Dexscreener unavailable', aeroUsdError: 'fetch unavailable' };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), MARKET_TIMEOUT_MS);
  try {
    const response = await fetch(AERO_DEXSCREENER_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Dexscreener ${response.status}`);

    const body = (await response.json()) as DexscreenerResponse;
    const pairs = body.pairs ?? [];
    const preferred = pairs.find((pair) =>
      pair.chainId === 'base' &&
      pair.dexId === 'aerodrome' &&
      pair.baseToken?.symbol?.toUpperCase() === 'AERO' &&
      pair.quoteToken?.symbol?.toUpperCase() === 'USDC' &&
      Number.isFinite(Number(pair.priceUsd)),
    ) ?? pairs.find((pair) =>
      pair.chainId === 'base' &&
      pair.baseToken?.symbol?.toUpperCase() === 'AERO' &&
      Number.isFinite(Number(pair.priceUsd)),
    );

    const aeroUsd = Number(preferred?.priceUsd);
    if (!Number.isFinite(aeroUsd) || aeroUsd <= 0) throw new Error('No usable AERO/USD pair');
    return {
      aeroUsd,
      aeroUsdSource: preferred?.pairAddress ? `Dexscreener · ${preferred.pairAddress}` : 'Dexscreener',
    };
  } catch (error) {
    return {
      aeroUsdSource: 'Dexscreener unavailable',
      aeroUsdError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function loadPosition(record: ManagedPositionRecord): Promise<LivePosition> {
  try {
    const [owner, position] = await Promise.all([
      client.readContract({ address: record.nftManager, abi: nftManagerAbi, functionName: 'ownerOf', args: [record.tokenId] }),
      client.readContract({ address: record.nftManager, abi: nftManagerAbi, functionName: 'positions', args: [record.tokenId] }),
    ]);

    let staked = owner.toLowerCase() === record.gauge.toLowerCase();
    let earnedAero = 0n;
    if (record.depositor) {
      staked = await client.readContract({
        address: record.gauge,
        abi: gaugeAbi,
        functionName: 'stakedContains',
        args: [record.depositor, record.tokenId],
      });
      if (staked) {
        earnedAero = await client.readContract({
          address: record.gauge,
          abi: gaugeAbi,
          functionName: 'earned',
          args: [record.depositor, record.tokenId],
        });
      }
    }

    return {
      ...record,
      owner,
      token0: position[2],
      token1: position[3],
      tickSpacing: position[4],
      tickLower: position[5],
      tickUpper: position[6],
      liquidity: position[7],
      tokensOwed0: position[10],
      tokensOwed1: position[11],
      staked,
      earnedAero,
    };
  } catch (error) {
    return { ...record, liveError: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [pool, walletBalances, positions, market] = await Promise.all([
    loadPoolSnapshot(),
    loadWalletBalances(),
    Promise.all(managedPositions.map((record) => loadPosition(record))),
    loadAeroUsdPrice(),
  ]);
  return { pool, walletBalances, positions, market, loadedAt: new Date() };
}

export function tokenDecimals(address?: Address): number {
  if (!address) return 18;
  const meta = Object.entries(TOKEN_META).find(([knownAddress]) => knownAddress.toLowerCase() === address.toLowerCase())?.[1];
  return meta?.decimals ?? 18;
}
