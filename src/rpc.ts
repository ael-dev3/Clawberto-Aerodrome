import { createPublicClient, fallback, http, parseAbiItem, type Address } from 'viem';
import { base } from 'viem/chains';

import { erc20Abi, gaugeAbi, nftManagerAbi, poolAbi } from './aero-abis';
import { CONTRACTS, RPC_ENDPOINTS, TOKEN_META, TRACKED_WALLETS, WALLET_ADDRESS } from './config';
import { managedPositions, type ManagedPositionRecord } from './positions';

const AERO_DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${CONTRACTS.aero}`;
const DEXSCREENER_PAIR_URL = 'https://api.dexscreener.com/latest/dex/pairs/base';
const MARKET_TIMEOUT_MS = 5_000;
const RPC_RETRY_ATTEMPTS = 3;
const RPC_RETRY_BASE_DELAY_MS = 350;
const DISCOVERY_MAX_WALLET_NFTS = 120;
const DISCOVERY_MAX_STAKED_NFTS = 120;
const DISCOVERY_MAX_GAUGE_NFTS = 48;
const DISCOVERY_RECENT_BLOCKS = 9_500n;
const DISCOVERY_LOG_CHUNK_BLOCKS = 9_500n;
const DISCOVERY_LOG_TIMEOUT_MS = 8_000;
const DISCOVERY_ENUM_TIMEOUT_MS = 8_000;
const gaugeDepositEvent = parseAbiItem('event Deposit(address indexed user, uint256 indexed tokenId, uint128 indexed liquidityToStake)');
const gaugeWithdrawEvent = parseAbiItem('event Withdraw(address indexed user, uint256 indexed tokenId, uint128 indexed liquidityToStake)');

export const client = createPublicClient({
  chain: base,
  transport: fallback(RPC_ENDPOINTS.map((url) => http(url, {
    timeout: 8_000,
    retryCount: 2,
    retryDelay: 350,
  }))),
});

export interface PoolSnapshot {
  currentTick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  stakedLiquidity: bigint;
  lfiBalance: bigint;
  usdcBalance: bigint;
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
  liveWarning?: string;
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
  positionDiscovery: PositionDiscoverySnapshot;
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
  positionAddresses: Address[];
  role: string;
  balances: WalletBalances;
  error?: string;
}

export interface PositionDiscoverySnapshot {
  source: string;
  staticRecords: number;
  walletNftsScanned: number;
  gaugeNftsScanned: number;
  gaugeLogsScanned: number;
  discoveredRecords: number;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function retryRpc<T>(label: string, read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RPC_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < RPC_RETRY_ATTEMPTS - 1) {
        await delay(RPC_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }
  }
  if (lastError instanceof Error) throw new Error(`${label} failed after ${RPC_RETRY_ATTEMPTS} attempts: ${lastError.message}`);
  throw new Error(`${label} failed after ${RPC_RETRY_ATTEMPTS} attempts: ${String(lastError)}`);
}

export async function loadPoolSnapshot(): Promise<PoolSnapshot> {
  const [slot0, liquidity, stakedLiquidity, lfiBalance, usdcBalance, fee, rewardRate, rewardsLeft] = await Promise.all([
    retryRpc('pool slot0', () => client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'slot0' })),
    retryRpc('pool liquidity', () => client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'liquidity' })),
    retryRpc('pool stakedLiquidity', () => client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'stakedLiquidity' })),
    retryRpc('pool LFI balance', () => client.readContract({ address: CONTRACTS.lfi, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.pool] })),
    retryRpc('pool USDC balance', () => client.readContract({ address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.pool] })),
    retryRpc('pool fee', () => client.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'fee' })),
    retryRpc('gauge rewardRate', () => client.readContract({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'rewardRate' })),
    retryRpc('gauge rewardsLeft', () => client.readContract({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'left' })),
  ]);

  return {
    sqrtPriceX96: slot0[0],
    currentTick: slot0[1],
    liquidity,
    stakedLiquidity,
    lfiBalance,
    usdcBalance,
    fee,
    rewardRate,
    rewardsLeft,
  };
}

export async function loadWalletBalances(address: Address = WALLET_ADDRESS): Promise<WalletBalances> {
  const [eth, lfi, usdc, aero] = await Promise.all([
    retryRpc('wallet ETH balance', () => client.getBalance({ address })),
    retryRpc('wallet LFI balance', () => client.readContract({ address: CONTRACTS.lfi, abi: erc20Abi, functionName: 'balanceOf', args: [address] })),
    retryRpc('wallet USDC balance', () => client.readContract({ address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address] })),
    retryRpc('wallet AERO balance', () => client.readContract({ address: CONTRACTS.aero, abi: erc20Abi, functionName: 'balanceOf', args: [address] })),
  ]);
  return { eth, lfi, usdc, aero };
}

export function sumWalletBalances(balances: readonly WalletBalances[]): WalletBalances {
  return balances.reduce<WalletBalances>((sum, item) => ({
    eth: sum.eth + item.eth,
    lfi: sum.lfi + item.lfi,
    usdc: sum.usdc + item.usdc,
    aero: sum.aero + item.aero,
  }), { eth: 0n, lfi: 0n, usdc: 0n, aero: 0n });
}

export function trackedPositionAddresses(wallet: { address: Address; positionAddresses?: readonly Address[] }): Address[] {
  const addresses = [wallet.address, ...(wallet.positionAddresses ?? [])];
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadTrackedWallet(wallet: (typeof TRACKED_WALLETS)[number]): Promise<TrackedWalletSnapshot> {
  try {
    const positionAddresses = trackedPositionAddresses(wallet);
    const balanceResults = await Promise.allSettled(positionAddresses.map((address) => loadWalletBalances(address)));
    const balances = balanceResults
      .filter((result): result is PromiseFulfilledResult<WalletBalances> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failures = balanceResults.filter((result) => result.status === 'rejected');
    if (balances.length === 0) {
      const [failure] = failures;
      throw failure?.reason ?? new Error('No tracked balance reads completed');
    }
    return {
      label: wallet.label,
      shortLabel: wallet.shortLabel,
      address: wallet.address,
      positionAddresses,
      role: wallet.role,
      balances: sumWalletBalances(balances),
      error: failures.length > 0 ? `${failures.length} tracked balance address${failures.length === 1 ? '' : 'es'} failed to load` : undefined,
    };
  } catch (error) {
    return {
      label: wallet.label,
      shortLabel: wallet.shortLabel,
      address: wallet.address,
      positionAddresses: trackedPositionAddresses(wallet),
      role: wallet.role,
      balances: { eth: 0n, lfi: 0n, usdc: 0n, aero: 0n },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isLfiUsdcPosition(position: LivePosition): boolean {
  const token0 = position.token0?.toLowerCase();
  const token1 = position.token1?.toLowerCase();
  return (
    token0 !== undefined &&
    token1 !== undefined &&
    (
      (token0 === CONTRACTS.lfi.toLowerCase() && token1 === CONTRACTS.usdc.toLowerCase()) ||
      (token0 === CONTRACTS.usdc.toLowerCase() && token1 === CONTRACTS.lfi.toLowerCase())
    )
  );
}

async function loadOwnerSlipstreamTokenIds(owner: Address, maxItems = DISCOVERY_MAX_WALLET_NFTS, scan: 'head' | 'tail' = 'head'): Promise<bigint[]> {
  const balance = await retryRpc('NFT owner balance', () => client.readContract({
    address: CONTRACTS.nftManager,
    abi: nftManagerAbi,
    functionName: 'balanceOf',
    args: [owner],
  }));
  const balanceCount = balance > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(balance);
  const count = Math.min(balanceCount, maxItems);
  if (!Number.isFinite(count) || count <= 0) return [];
  const start = scan === 'tail' && balanceCount > count ? balanceCount - count : 0;
  const indexes = Array.from({ length: count }, (_, index) => start + index);

  return await Promise.all(indexes.map((index) => retryRpc('NFT owner token index', () => client.readContract({
    address: CONTRACTS.nftManager,
    abi: nftManagerAbi,
    functionName: 'tokenOfOwnerByIndex',
    args: [owner, BigInt(index)],
  }))));
}

async function loadGaugeStakedTokenIds(depositor: Address, maxItems = DISCOVERY_MAX_STAKED_NFTS): Promise<bigint[]> {
  const balance = await retryRpc('gauge staked NFT count', () => client.readContract({
    address: CONTRACTS.gauge,
    abi: gaugeAbi,
    functionName: 'stakedLength',
    args: [depositor],
  }));
  const balanceCount = balance > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(balance);
  const count = Math.min(balanceCount, maxItems);
  if (!Number.isFinite(count) || count <= 0) return [];

  return await Promise.all(Array.from({ length: count }, (_, index) => retryRpc('gauge staked NFT index', () => client.readContract({
    address: CONTRACTS.gauge,
    abi: gaugeAbi,
    functionName: 'stakedByIndex',
    args: [depositor, BigInt(index)],
  }))));
}

function pushRecord(records: Map<string, ManagedPositionRecord>, record: ManagedPositionRecord): void {
  const key = `${record.nftManager.toLowerCase()}:${record.tokenId.toString()}:${record.depositor?.toLowerCase() ?? 'owner'}`;
  if (!records.has(key)) records.set(key, record);
}

function appendDiscoveryError(discovery: PositionDiscoverySnapshot, message: string): void {
  discovery.error = discovery.error ? `${discovery.error}; ${message}` : message;
}

function appendActionableDiscoveryError(discovery: PositionDiscoverySnapshot, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('timed out after')) return;
  appendDiscoveryError(discovery, message);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = globalThis.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

function isNewerLog(
  candidate: { blockNumber: bigint; logIndex: number },
  current: { blockNumber: bigint; logIndex: number },
): boolean {
  return candidate.blockNumber > current.blockNumber ||
    (candidate.blockNumber === current.blockNumber && candidate.logIndex > current.logIndex);
}

interface GaugeStakeLog {
  args: { user?: Address; tokenId?: bigint };
  blockNumber: bigint;
  logIndex: number;
}

async function getGaugeLogsChunked(
  event: typeof gaugeDepositEvent | typeof gaugeWithdrawEvent,
  wallet: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<GaugeStakeLog[]> {
  const logs: GaugeStakeLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += DISCOVERY_LOG_CHUNK_BLOCKS + 1n) {
    const end = start + DISCOVERY_LOG_CHUNK_BLOCKS > toBlock ? toBlock : start + DISCOVERY_LOG_CHUNK_BLOCKS;
    const chunk = await retryRpc('gauge event logs', () => client.getLogs({
      address: CONTRACTS.gauge,
      event,
      args: { user: wallet },
      fromBlock: start,
      toBlock: end,
    }));
    logs.push(...chunk);
  }
  return logs;
}

async function discoverGaugeLogRecords(): Promise<{ records: ManagedPositionRecord[]; logsScanned: number }> {
  const latestBlock = await retryRpc('latest block', () => client.getBlockNumber());
  const fromBlock = latestBlock > DISCOVERY_RECENT_BLOCKS ? latestBlock - DISCOVERY_RECENT_BLOCKS : 0n;
  const records: ManagedPositionRecord[] = [];
  let logsScanned = 0;

  await Promise.all(TRACKED_WALLETS.map(async (wallet) => {
    const positionAddresses = trackedPositionAddresses(wallet);
    const [deposits, withdrawals] = await Promise.all([
      Promise.all(positionAddresses.map((address) => getGaugeLogsChunked(gaugeDepositEvent, address, fromBlock, latestBlock))).then((groups) => groups.flat()),
      Promise.all(positionAddresses.map((address) => getGaugeLogsChunked(gaugeWithdrawEvent, address, fromBlock, latestBlock))).then((groups) => groups.flat()),
    ]);
    logsScanned += deposits.length + withdrawals.length;
    const latestByToken = new Map<string, {
      tokenId: bigint;
      kind: 'deposit' | 'withdraw';
      blockNumber: bigint;
      logIndex: number;
      depositor: Address;
    }>();
    for (const log of deposits) {
      const tokenId = log.args.tokenId;
      if (tokenId === undefined) continue;
      const key = tokenId.toString();
      const next = { tokenId, kind: 'deposit' as const, blockNumber: log.blockNumber, logIndex: log.logIndex, depositor: log.args.user as Address };
      const current = latestByToken.get(key);
      if (!current || isNewerLog(next, current)) latestByToken.set(key, next);
    }
    for (const log of withdrawals) {
      const tokenId = log.args.tokenId;
      if (tokenId === undefined) continue;
      const key = tokenId.toString();
      const next = { tokenId, kind: 'withdraw' as const, blockNumber: log.blockNumber, logIndex: log.logIndex, depositor: log.args.user as Address };
      const current = latestByToken.get(key);
      if (!current || isNewerLog(next, current)) latestByToken.set(key, next);
    }
    for (const event of latestByToken.values()) {
      if (event.kind !== 'deposit') continue;
      records.push({
        tokenId: event.tokenId,
        label: `${wallet.shortLabel} staked NFT`,
        origin: wallet.role === 'agent' ? 'hermes-managed' : 'ael-existing',
        pair: 'LFI/USDC',
        pool: CONTRACTS.pool,
        gauge: CONTRACTS.gauge,
        nftManager: CONTRACTS.nftManager,
        depositor: event.depositor,
        enteredAt: 'Discovered live',
        intendedRange: 'Current gauge-staked Slipstream NFT',
        notes: 'Discovered from recent gauge Deposit/Withdraw logs for a tracked wallet or LP controller and verified with stakedContains.',
        setupTxs: [],
      });
    }
  }));

  return { records, logsScanned };
}

async function discoverPositionRecords(): Promise<{ records: ManagedPositionRecord[]; discovery: PositionDiscoverySnapshot }> {
  const records = new Map<string, ManagedPositionRecord>();
  for (const record of managedPositions) pushRecord(records, record);

  const discovery: PositionDiscoverySnapshot = {
    source: 'Base RPC wallet/controller NFT custody + direct gauge stake enumeration',
    staticRecords: managedPositions.length,
    walletNftsScanned: 0,
    gaugeNftsScanned: 0,
    gaugeLogsScanned: 0,
    discoveredRecords: 0,
  };

  try {
    const walletTokenGroups = await Promise.all(TRACKED_WALLETS.flatMap((wallet) => trackedPositionAddresses(wallet).map(async (address) => ({
      wallet,
      address,
      tokenIds: await loadOwnerSlipstreamTokenIds(address, DISCOVERY_MAX_WALLET_NFTS, 'head'),
    }))));
    for (const { wallet, address, tokenIds } of walletTokenGroups) {
      discovery.walletNftsScanned += tokenIds.length;
      for (const tokenId of tokenIds) {
        pushRecord(records, {
          tokenId,
          label: `${wallet.shortLabel} wallet NFT`,
          origin: wallet.role === 'agent' ? 'hermes-managed' : 'ael-existing',
          pair: 'LFI/USDC',
          pool: CONTRACTS.pool,
          gauge: CONTRACTS.gauge,
          nftManager: CONTRACTS.nftManager,
          depositor: address,
          enteredAt: 'Discovered live',
          intendedRange: 'Current wallet-held Slipstream NFT',
          notes: 'Discovered from ERC-721 enumerable ownership for a tracked wallet or LP controller and verified through Base RPC before display.',
          setupTxs: [],
        });
      }
    }

    const stakedTokenGroups = await Promise.all(TRACKED_WALLETS.flatMap((wallet) => trackedPositionAddresses(wallet).map(async (address) => ({
      wallet,
      address,
      tokenIds: await loadGaugeStakedTokenIds(address),
    }))));
    for (const { wallet, address, tokenIds } of stakedTokenGroups) {
      discovery.gaugeNftsScanned += tokenIds.length;
      for (const tokenId of tokenIds) {
        pushRecord(records, {
          tokenId,
          label: `${wallet.shortLabel} staked NFT`,
          origin: wallet.role === 'agent' ? 'hermes-managed' : 'ael-existing',
          pair: 'LFI/USDC',
          pool: CONTRACTS.pool,
          gauge: CONTRACTS.gauge,
          nftManager: CONTRACTS.nftManager,
          depositor: address,
          enteredAt: 'Discovered live',
          intendedRange: 'Current gauge-staked Slipstream NFT',
          notes: 'Discovered from gauge stakedByIndex(depositor, index) for a tracked wallet or LP controller and verified through Base RPC before display.',
          setupTxs: [],
        });
      }
    }

    try {
      const gaugeLogRecords = await withTimeout(discoverGaugeLogRecords(), DISCOVERY_LOG_TIMEOUT_MS, 'Gauge depositor log discovery');
      discovery.gaugeLogsScanned = gaugeLogRecords.logsScanned;
      for (const record of gaugeLogRecords.records) pushRecord(records, record);
    } catch (error) {
      appendActionableDiscoveryError(discovery, error);
    }

    try {
      const gaugeTokenIds = await withTimeout(
        loadOwnerSlipstreamTokenIds(CONTRACTS.gauge, DISCOVERY_MAX_GAUGE_NFTS, 'tail'),
        DISCOVERY_ENUM_TIMEOUT_MS,
        'Gauge NFT custody sampling',
      );
      discovery.gaugeNftsScanned += gaugeTokenIds.length;
      await withTimeout(Promise.all(gaugeTokenIds.flatMap((tokenId) => TRACKED_WALLETS.flatMap((wallet) => trackedPositionAddresses(wallet).map(async (address) => {
        const staked = await retryRpc('gauge stake membership', () => client.readContract({
          address: CONTRACTS.gauge,
          abi: gaugeAbi,
          functionName: 'stakedContains',
          args: [address, tokenId],
        })).catch(() => false);
        if (!staked) return;
        pushRecord(records, {
          tokenId,
          label: `${wallet.shortLabel} staked NFT`,
          origin: wallet.role === 'agent' ? 'hermes-managed' : 'ael-existing',
          pair: 'LFI/USDC',
          pool: CONTRACTS.pool,
          gauge: CONTRACTS.gauge,
          nftManager: CONTRACTS.nftManager,
          depositor: address,
          enteredAt: 'Discovered live',
          intendedRange: 'Current gauge-staked Slipstream NFT',
          notes: 'Discovered from recent gauge ERC-721 custody and confirmed with stakedContains(depositor, tokenId).',
          setupTxs: [],
        });
      })))), DISCOVERY_ENUM_TIMEOUT_MS, 'Gauge depositor membership sampling');
    } catch (error) {
      appendActionableDiscoveryError(discovery, error);
    }
  } catch (error) {
    appendActionableDiscoveryError(discovery, error);
  }

  discovery.discoveredRecords = Math.max(0, records.size - managedPositions.length);
  return { records: [...records.values()], discovery };
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
      retryRpc('position owner', () => client.readContract({ address: record.nftManager, abi: nftManagerAbi, functionName: 'ownerOf', args: [record.tokenId] })),
      retryRpc('position data', () => client.readContract({ address: record.nftManager, abi: nftManagerAbi, functionName: 'positions', args: [record.tokenId] })),
    ]);

    let staked = owner.toLowerCase() === record.gauge.toLowerCase();
    let earnedAero: bigint | undefined = staked ? undefined : 0n;
    let liveWarning: string | undefined;
    const depositor = record.depositor;
    if (depositor) {
      try {
        staked = await retryRpc('position stake membership', () => client.readContract({
          address: record.gauge,
          abi: gaugeAbi,
          functionName: 'stakedContains',
          args: [depositor, record.tokenId],
        }));
      } catch (error) {
        liveWarning = `Stake membership read failed; using ownerOf custody: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (staked) {
        try {
          earnedAero = await retryRpc('position earned AERO', () => client.readContract({
            address: record.gauge,
            abi: gaugeAbi,
            functionName: 'earned',
            args: [depositor, record.tokenId],
          }));
        } catch (error) {
          liveWarning = liveWarning
            ? `${liveWarning}; Earned AERO read failed: ${error instanceof Error ? error.message : String(error)}`
            : `Earned AERO read failed: ${error instanceof Error ? error.message : String(error)}`;
        }
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
      liveWarning,
    };
  } catch (error) {
    return { ...record, liveError: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [pool, trackedWallets, discovered, market] = await Promise.all([
    loadPoolSnapshot(),
    Promise.all(TRACKED_WALLETS.map((wallet) => loadTrackedWallet(wallet))),
    discoverPositionRecords(),
    loadMarketSnapshot(),
  ]);
  const rawPositions = await Promise.all(discovered.records.map((record) => loadPosition(record)));
  const positions = rawPositions.filter((position) => !position.liveError && isLfiUsdcPosition(position));
  const walletBalances = trackedWallets.find((wallet) => wallet.address.toLowerCase() === WALLET_ADDRESS.toLowerCase())?.balances
    ?? { eth: 0n, lfi: 0n, usdc: 0n, aero: 0n };
  return {
    pool,
    walletBalances,
    trackedWallets,
    positions,
    market,
    positionDiscovery: discovered.discovery,
    loadedAt: new Date(),
  };
}

export function tokenDecimals(address?: Address): number {
  if (!address) return 18;
  const meta = Object.entries(TOKEN_META).find(([knownAddress]) => knownAddress.toLowerCase() === address.toLowerCase())?.[1];
  return meta?.decimals ?? 18;
}
