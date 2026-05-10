import { createPublicClient, fallback, http, type Address } from 'viem';
import { base } from 'viem/chains';

import { erc20Abi, gaugeAbi, nftManagerAbi, poolAbi } from './aero-abis';
import { CONTRACTS, RPC_ENDPOINTS, TOKEN_META, TRACKED_WALLETS, WALLET_ADDRESS } from './config';
import { managedPositions, type ManagedPositionRecord } from './positions';

const AERO_DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${CONTRACTS.aero}`;
const DEXSCREENER_PAIR_URL = 'https://api.dexscreener.com/latest/dex/pairs/base';
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
  lfiUsd?: number;
  ethUsd?: number;
  managedPair?: PairMarketSnapshot;
  referencePair?: PairMarketSnapshot;
}

export interface DashboardSnapshot {
  pool: PoolSnapshot;
  positions: LivePosition[];
  walletBalances: WalletBalances;
  trackedWallets: TrackedWalletSnapshot[];
  market: MarketSnapshot;
  loadedAt: Date;
}

interface DexscreenerPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  labels?: string[];
  priceNative?: string;
  priceUsd?: string;
  baseToken?: { symbol?: string; address?: string };
  quoteToken?: { symbol?: string; address?: string };
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
}

interface DexscreenerResponse {
  pairs?: DexscreenerPair[];
  pair?: DexscreenerPair;
}

export interface PairMarketSnapshot {
  pairAddress: Address;
  dexId?: string;
  url?: string;
  baseSymbol?: string;
  quoteSymbol?: string;
  priceUsd?: number;
  priceNative?: number;
  liquidityUsd?: number;
  liquidityBase?: number;
  liquidityQuote?: number;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  source: string;
  error?: string;
}

export interface TrackedWalletSnapshot {
  label: string;
  shortLabel: string;
  address: Address;
  role: string;
  balances: WalletBalances;
  error?: string;
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

export async function loadWalletBalances(address: Address = WALLET_ADDRESS): Promise<WalletBalances> {
  const [eth, lfi, usdc, aero] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: CONTRACTS.lfi, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
    client.readContract({ address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
    client.readContract({ address: CONTRACTS.aero, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ]);
  return { eth, lfi, usdc, aero };
}

export async function loadTrackedWallet(wallet: (typeof TRACKED_WALLETS)[number]): Promise<TrackedWalletSnapshot> {
  try {
    return {
      label: wallet.label,
      shortLabel: wallet.shortLabel,
      address: wallet.address,
      role: wallet.role,
      balances: await loadWalletBalances(wallet.address),
    };
  } catch (error) {
    return {
      label: wallet.label,
      shortLabel: wallet.shortLabel,
      address: wallet.address,
      role: wallet.role,
      balances: { eth: 0n, lfi: 0n, usdc: 0n, aero: 0n },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadAeroUsdPrice(): Promise<MarketSnapshot> {
  if (typeof fetch === 'undefined') {
    return { aeroUsdSource: 'Dexscreener unavailable', aeroUsdError: 'fetch unavailable' };
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), MARKET_TIMEOUT_MS);
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
      aeroUsdSource: preferred?.pairAddress ? `Dexscreener - ${preferred.pairAddress}` : 'Dexscreener',
    };
  } catch (error) {
    return {
      aeroUsdSource: 'Dexscreener unavailable',
      aeroUsdError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizePair(pair: DexscreenerPair | undefined, pairAddress: Address): PairMarketSnapshot {
  if (!pair) {
    return {
      pairAddress,
      source: 'Dexscreener unavailable',
      error: 'No pair payload returned',
    };
  }

  return {
    pairAddress,
    dexId: pair.dexId,
    url: pair.url,
    baseSymbol: pair.baseToken?.symbol,
    quoteSymbol: pair.quoteToken?.symbol,
    priceUsd: finiteNumber(pair.priceUsd),
    priceNative: finiteNumber(pair.priceNative),
    liquidityUsd: finiteNumber(pair.liquidity?.usd),
    liquidityBase: finiteNumber(pair.liquidity?.base),
    liquidityQuote: finiteNumber(pair.liquidity?.quote),
    volume: pair.volume,
    priceChange: pair.priceChange,
    source: pair.pairAddress ? `Dexscreener - ${pair.pairAddress}` : 'Dexscreener',
  };
}

export async function loadPairMarket(pairAddress: Address): Promise<PairMarketSnapshot> {
  if (typeof fetch === 'undefined') {
    return { pairAddress, source: 'Dexscreener unavailable', error: 'fetch unavailable' };
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), MARKET_TIMEOUT_MS);
  try {
    const response = await fetch(`${DEXSCREENER_PAIR_URL}/${pairAddress}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Dexscreener ${response.status}`);
    const body = (await response.json()) as DexscreenerResponse;
    return normalizePair(body.pair ?? body.pairs?.[0], pairAddress);
  } catch (error) {
    return {
      pairAddress,
      source: 'Dexscreener unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function loadMarketSnapshot(): Promise<MarketSnapshot> {
  const [aeroMarket, managedPair, referencePair] = await Promise.all([
    loadAeroUsdPrice(),
    loadPairMarket(CONTRACTS.pool),
    loadPairMarket(CONTRACTS.lfiReferencePool),
  ]);
  const lfiUsd = managedPair.priceUsd ?? referencePair.priceUsd;
  const ethUsd = referencePair.priceUsd && referencePair.priceNative
    ? referencePair.priceUsd / referencePair.priceNative
    : undefined;
  return {
    ...aeroMarket,
    lfiUsd,
    ethUsd,
    managedPair,
    referencePair,
  };
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
  const [pool, trackedWallets, positions, market] = await Promise.all([
    loadPoolSnapshot(),
    Promise.all(TRACKED_WALLETS.map((wallet) => loadTrackedWallet(wallet))),
    Promise.all(managedPositions.map((record) => loadPosition(record))),
    loadMarketSnapshot(),
  ]);
  const walletBalances = trackedWallets.find((wallet) => wallet.address.toLowerCase() === WALLET_ADDRESS.toLowerCase())?.balances
    ?? { eth: 0n, lfi: 0n, usdc: 0n, aero: 0n };
  return { pool, walletBalances, trackedWallets, positions, market, loadedAt: new Date() };
}

export function tokenDecimals(address?: Address): number {
  if (!address) return 18;
  const meta = Object.entries(TOKEN_META).find(([knownAddress]) => knownAddress.toLowerCase() === address.toLowerCase())?.[1];
  return meta?.decimals ?? 18;
}
