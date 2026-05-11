#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  concatHex,
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  maxUint256,
  numberToHex,
  parseEventLogs,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const RUN_DIR = path.join(REPO, 'runs', 'aerodrome-one-cron');
const DASHBOARD_SYNC_REQUEST_DIR = path.join(REPO, 'runs', 'aerodrome-dashboard-sync');
const STATE_PATH = path.join(RUN_DIR, 'state.json');
const LOCK_PATH = path.join(RUN_DIR, 'rebalance.lock');

const RPC_URL = process.env.HERMES_RPC_URL || 'https://base-rpc.publicnode.com';
const DISCOVERY_FORWARD_SCAN = Number(process.env.HERMES_DISCOVERY_FORWARD_SCAN || '250');
const WALLET = '0xC979efda857823bcA9A335a6c7b62A7531e1cFEA';
const KEYCHAIN_SERVICE = 'Hermes Farcaster Wallet';
const CHAIN_ID = 8453;

const CONTRACTS = {
  pool: '0x8343c68279587498526114e6385f0a87f248e0d9',
  gauge: '0xE9C73937382C621770f5b7018A407C0749df6aaE',
  nftManager: '0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53',
  router: '0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F',
  lfi: '0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  weth: '0x4200000000000000000000000000000000000006',
};

const TICK_SPACING = 200;
const DESIRED_WIDTH_TICKS = 200;
const SLIPPAGE_BPS = BigInt(process.env.HERMES_SLIPPAGE_BPS || '30');
const ETH_GAS_RESERVE_USD = Number(process.env.HERMES_ETH_GAS_RESERVE_USD || '1.5');
const MIN_ETH_SWAP_USD = Number(process.env.HERMES_MIN_ETH_SWAP_USD || '0.25');
const MIN_ETH_SWAP_WEI = 50_000_000_000_000n;
const MIN_REBALANCE_USD = 0.15;
const IDLE_REDEPLOY_USD = Number(process.env.HERMES_IDLE_REDEPLOY_USD || '2');
const MIN_POSITION_USD = Number(process.env.HERMES_MIN_POSITION_USD || '1');
const REBALANCE_COOLDOWN_SECONDS = Number(process.env.HERMES_REBALANCE_COOLDOWN_SECONDS || '600');
const EXTRA_TOKEN_IDS = (process.env.HERMES_EXTRA_TOKEN_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const MAX_UINT128 = (1n << 128n) - 1n;
const ZERO = '0x0000000000000000000000000000000000000000';

const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

const poolAbi = [
  {
    type: 'function', name: 'slot0', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
];

const gaugeAbi = [
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'stakedContains', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'earned', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
];

const nftManagerAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
  {
    type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
  },
  {
    type: 'function', name: 'collect', stateMutability: 'payable',
    inputs: [{
      components: [
        { name: 'tokenId', type: 'uint256' },
        { name: 'recipient', type: 'address' },
        { name: 'amount0Max', type: 'uint128' },
        { name: 'amount1Max', type: 'uint128' },
      ], name: 'params', type: 'tuple',
    }],
    outputs: [{ name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' }],
  },
  {
    type: 'function', name: 'decreaseLiquidity', stateMutability: 'payable',
    inputs: [{
      components: [
        { name: 'tokenId', type: 'uint256' },
        { name: 'liquidity', type: 'uint128' },
        { name: 'amount0Min', type: 'uint256' },
        { name: 'amount1Min', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ], name: 'params', type: 'tuple',
    }],
    outputs: [{ name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' }],
  },
  { type: 'function', name: 'burn', stateMutability: 'payable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
  {
    type: 'function', name: 'mint', stateMutability: 'payable',
    inputs: [{
      components: [
        { name: 'token0', type: 'address' },
        { name: 'token1', type: 'address' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'tickLower', type: 'int24' },
        { name: 'tickUpper', type: 'int24' },
        { name: 'amount0Desired', type: 'uint256' },
        { name: 'amount1Desired', type: 'uint256' },
        { name: 'amount0Min', type: 'uint256' },
        { name: 'amount1Min', type: 'uint256' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'sqrtPriceX96', type: 'uint160' },
      ], name: 'params', type: 'tuple',
    }],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  { type: 'event', name: 'Transfer', anonymous: false, inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: true, name: 'tokenId', type: 'uint256' }] },
];

const routerAbi = [
  {
    type: 'function', name: 'exactInput', stateMutability: 'payable',
    inputs: [{
      components: [
        { name: 'path', type: 'bytes' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
      ], name: 'params', type: 'tuple',
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
];

const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL, { timeout: 15_000 }) });
let account;
let walletClient;
let txs = [];

function nowIso() { return new Date().toISOString(); }
function unixDeadline(minutes = 10) { return BigInt(Math.floor(Date.now() / 1000) + minutes * 60); }
function sameAddress(a, b) { return a?.toLowerCase() === b?.toLowerCase(); }
function tickPrice(tick) { return Math.pow(1.0001, tick) * 1e12; }
function fmt(raw, decimals, digits = 6) { return Number(formatUnits(raw, decimals)).toLocaleString('en-US', { maximumFractionDigits: digits }); }
function usd(n) { return `$${Number(n).toFixed(4)}`; }
function slippageMin(amount, bps = SLIPPAGE_BPS) { return amount <= 0n ? 0n : (amount * (10_000n - bps)) / 10_000n; }
function roundDownTick(tick) { return Math.floor(tick / TICK_SPACING) * TICK_SPACING; }
function desiredRange(currentTick) { const lowerTick = roundDownTick(currentTick); return { lowerTick, upperTick: lowerTick + DESIRED_WIDTH_TICKS }; }
function rangeState(currentTick, lowerTick, upperTick) { return currentTick < lowerTick ? 'BELOW_RANGE' : currentTick >= upperTick ? 'ABOVE_RANGE' : 'IN_RANGE'; }
function rangeLabel(lowerTick, upperTick) { return `${lowerTick} to ${upperTick}`; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function ensureRunDir() { mkdirSync(RUN_DIR, { recursive: true }); }
function stringifyJson(value) { return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2); }
function writeJson(file, value) { writeFileSync(file, stringifyJson(value) + '\n'); }
function readJson(file, fallback) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } }
function tokenIdsFromText(text) { return [...text.matchAll(/(?:tokenId[: #]*|NFT #|sim#)(\d{5,})/g)].map((match) => match[1]); }
function positionUsdValue({ lfiRaw = 0n, usdcRaw = 0n, tick }) { return Number(formatUnits(lfiRaw, 18)) * tickPrice(tick) + Number(formatUnits(usdcRaw, 6)); }
function recentRebalanceAgeSeconds() {
  const state = readJson(STATE_PATH, {});
  if (!['REBALANCED', 'REMEDIATED'].includes(state.status) || !state.at) return Infinity;
  const atMs = Date.parse(state.at);
  return Number.isFinite(atMs) ? (Date.now() - atMs) / 1000 : Infinity;
}

function pidIsAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try { process.kill(numericPid, 0); return true; } catch { return false; }
}

function acquireLock() {
  ensureRunDir();
  if (existsSync(LOCK_PATH)) {
    const lock = readJson(LOCK_PATH, {});
    const ageMs = Date.now() - Date.parse(lock.at || 0);
    if (pidIsAlive(lock.pid) && ageMs < 10 * 60 * 1000) {
      console.log(stringifyJson({ status: 'LOCKED', lock }));
      process.exit(0);
    }
    try { unlinkSync(LOCK_PATH); } catch {}
  }
  writeJson(LOCK_PATH, { at: nowIso(), pid: process.pid });
}

function releaseLock() {
  try { unlinkSync(LOCK_PATH); } catch {}
}

function loadPrivateKey() {
  const envKey = process.env.HERMES_PRIVATE_KEY?.trim();
  if (envKey) return envKey.startsWith('0x') ? envKey : `0x${envKey}`;
  const key = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', WALLET, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!key) throw new Error('missing keychain private key');
  return key.startsWith('0x') ? key : `0x${key}`;
}

function initSigner() {
  const privateKey = loadPrivateKey();
  account = privateKeyToAccount(privateKey);
  if (!sameAddress(account.address, WALLET)) throw new Error(`keychain account mismatch: ${account.address}`);
  walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL, { timeout: 15_000 }) });
}

function encodePath(tokens, tickSpacings) {
  if (tokens.length !== tickSpacings.length + 1) throw new Error('bad path shape');
  const parts = [tokens[0]];
  for (let i = 0; i < tickSpacings.length; i += 1) {
    parts.push(numberToHex(tickSpacings[i], { size: 3 }));
    parts.push(tokens[i + 1]);
  }
  return concatHex(parts);
}

async function waitTx(hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  txs.push({ label, hash });
  console.log(`${label}: ${hash}`);
  return receipt;
}

function bufferedGasLimit(estimatedGas) {
  const gas = BigInt(estimatedGas);
  if (gas <= 0n) throw new Error(`invalid gas estimate: ${estimatedGas}`);
  return gas + gas / 2n + 25_000n;
}

async function simulateAndSend({ address, abi, functionName, args = [], value = 0n, label }) {
  const { request, result } = await publicClient.simulateContract({ account, address, abi, functionName, args, value, chain: base });
  const estimatedGas = await publicClient.estimateContractGas({ account, address, abi, functionName, args, value });
  const gas = bufferedGasLimit(estimatedGas);
  const hash = await walletClient.writeContract({ ...request, gas });
  const receipt = await waitTx(hash, label);
  return { result, receipt, hash };
}

async function readPool() {
  const slot0 = await publicClient.readContract({ address: CONTRACTS.pool, abi: poolAbi, functionName: 'slot0' });
  return { sqrtPriceX96: slot0[0], currentTick: Number(slot0[1]), unlocked: slot0[5] };
}

async function readBalances() {
  const [eth, lfi, usdc] = await Promise.all([
    publicClient.getBalance({ address: WALLET }),
    publicClient.readContract({ address: CONTRACTS.lfi, abi: erc20Abi, functionName: 'balanceOf', args: [WALLET] }),
    publicClient.readContract({ address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [WALLET] }),
  ]);
  return { eth, lfi, usdc };
}

async function readPosition(tokenId) {
  const [owner, p] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'ownerOf', args: [BigInt(tokenId)] }),
    publicClient.readContract({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'positions', args: [BigInt(tokenId)] }),
  ]);
  return {
    tokenId: BigInt(tokenId),
    owner,
    token0: p[2],
    token1: p[3],
    tickSpacing: Number(p[4]),
    tickLower: Number(p[5]),
    tickUpper: Number(p[6]),
    liquidity: p[7],
    tokensOwed0: p[10],
    tokensOwed1: p[11],
  };
}

async function stakedContains(tokenId) {
  return publicClient.readContract({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'stakedContains', args: [WALLET, BigInt(tokenId)] });
}

async function earned(tokenId) {
  return publicClient.readContract({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'earned', args: [WALLET, BigInt(tokenId)] });
}

function candidateManagedTokenIds() {
  const ids = new Set(EXTRA_TOKEN_IDS);
  for (const file of [
    STATE_PATH,
    path.join(RUN_DIR, 'launchd.out.log'),
    path.join(RUN_DIR, 'launchd.err.log'),
  ]) {
    try {
      for (const id of tokenIdsFromText(readFileSync(file, 'utf8'))) ids.add(id);
    } catch {}
  }
  const numeric = [...ids].map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  const highestKnown = numeric.length ? Math.max(...numeric) : 0;
  const forwardScan = Math.max(0, Number.isFinite(DISCOVERY_FORWARD_SCAN) ? Math.floor(DISCOVERY_FORWARD_SCAN) : 0);
  for (let tokenId = highestKnown + 1; tokenId <= highestKnown + forwardScan; tokenId += 1) ids.add(String(tokenId));
  return [...ids].map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
}

async function currentManagedTokenId(pool = undefined) {
  const active = await discoverStakedManagedPosition(pool);
  return active?.tokenId;
}

async function discoverStakedManagedPosition(pool = undefined) {
  const currentPool = pool ?? await readPool();
  const matches = [];
  for (const tokenId of [...candidateManagedTokenIds()].reverse()) {
    const pos = await readPositionMaybe(tokenId);
    if (!isManagedPoolPosition(pos) || pos.liquidity <= 0n) continue;
    if (!sameAddress(pos.owner, CONTRACTS.gauge)) continue;
    const contains = await stakedContains(tokenId).catch(() => false);
    if (contains !== true) continue;
    matches.push({ tokenId, position: pos, stakedContains: contains, rangeState: rangeState(currentPool.currentTick, pos.tickLower, pos.tickUpper) });
  }
  return matches.sort((a, b) => {
    if (a.rangeState === 'IN_RANGE' && b.rangeState !== 'IN_RANGE') return -1;
    if (a.rangeState !== 'IN_RANGE' && b.rangeState === 'IN_RANGE') return 1;
    return b.tokenId - a.tokenId;
  })[0];
}

async function readPositionMaybe(tokenId) {
  try {
    return await readPosition(tokenId);
  } catch (error) {
    return { tokenId: BigInt(tokenId), error: error instanceof Error ? error.message : String(error) };
  }
}

function isManagedPoolPosition(pos) {
  return !pos.error && sameAddress(pos.token0, CONTRACTS.lfi) && sameAddress(pos.token1, CONTRACTS.usdc) && pos.tickSpacing === TICK_SPACING;
}

async function ensureAllowance(token, spender, amount, symbol, labelPrefix = 'Approve') {
  const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [WALLET, spender] });
  if (allowance >= amount) return;
  await simulateAndSend({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
    label: `${labelPrefix} ${symbol}`,
  });
}

async function quoteExactInput(pathBytes, amountIn, value = 0n) {
  const params = { path: pathBytes, recipient: WALLET, deadline: unixDeadline(), amountIn, amountOutMinimum: 0n };
  const { result } = await publicClient.simulateContract({ account, address: CONTRACTS.router, abi: routerAbi, functionName: 'exactInput', args: [params], value, chain: base });
  return result;
}

async function swapExactInput(pathBytes, amountIn, minOut, value, label) {
  const params = { path: pathBytes, recipient: WALLET, deadline: unixDeadline(), amountIn, amountOutMinimum: minOut };
  const { result } = await simulateAndSend({ address: CONTRACTS.router, abi: routerAbi, functionName: 'exactInput', args: [params], value, label });
  return result;
}

async function bestWethUsdcPath(amountIn) {
  const candidates = [1, 50];
  const quotes = [];
  for (const spacing of candidates) {
    const p = encodePath([CONTRACTS.weth, CONTRACTS.usdc], [spacing]);
    try {
      const out = await quoteExactInput(p, amountIn, amountIn);
      quotes.push({ spacing, path: p, out });
    } catch (error) {
      quotes.push({ spacing, error: error instanceof Error ? error.message : String(error), out: 0n });
    }
  }
  quotes.sort((a, b) => (a.out > b.out ? -1 : a.out < b.out ? 1 : 0));
  if (!quotes[0]?.out) throw new Error(`no WETH/USDC route: ${JSON.stringify(quotes)}`);
  return quotes[0];
}

function unitRangeFractions(currentTick, lowerTick, upperTick) {
  const L = 1_000_000_000_000_000;
  const sqrtLower = Math.pow(1.0001, lowerTick / 2);
  const sqrtUpper = Math.pow(1.0001, upperTick / 2);
  const sqrtCurrent = Math.pow(1.0001, currentTick / 2);
  const sqrtPrice = Math.max(sqrtLower, Math.min(sqrtCurrent, sqrtUpper));
  let token0Raw = 0;
  let token1Raw = 0;
  if (currentTick < lowerTick) token0Raw = L * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
  else if (currentTick >= upperTick) token1Raw = L * (sqrtUpper - sqrtLower);
  else {
    token0Raw = L * (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper);
    token1Raw = L * (sqrtPrice - sqrtLower);
  }
  const price = tickPrice(currentTick);
  const token0Usd = (token0Raw / 1e18) * price;
  const token1Usd = token1Raw / 1e6;
  const total = token0Usd + token1Usd;
  return total > 0 ? { lfiFrac: token0Usd / total, usdcFrac: token1Usd / total } : { lfiFrac: 0.5, usdcFrac: 0.5 };
}

async function exitOldPosition(tokenId) {
  let pos;
  try {
    pos = await readPosition(tokenId);
  } catch (error) {
    console.log(`old position #${tokenId} unreadable/skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { exited: false, burned: false };
  }

  if (!sameAddress(pos.token0, CONTRACTS.lfi) || !sameAddress(pos.token1, CONTRACTS.usdc) || pos.tickSpacing !== TICK_SPACING) {
    throw new Error(`position identity mismatch for #${tokenId}`);
  }

  return closeManagedPosition(tokenId, `old NFT #${tokenId}`);
}

async function closeManagedPosition(tokenId, label = `NFT #${tokenId}`) {
  let pos = await readPosition(tokenId);
  if (!isManagedPoolPosition(pos)) throw new Error(`position identity mismatch for #${tokenId}`);

  if (sameAddress(pos.owner, CONTRACTS.gauge)) {
    const contains = await stakedContains(tokenId);
    if (!contains) throw new Error(`gauge owns #${tokenId} but depositor membership is false`);
    await simulateAndSend({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'withdraw', args: [BigInt(tokenId)], label: `Withdraw ${label}` });
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      pos = await readPosition(tokenId);
      if (sameAddress(pos.owner, WALLET)) break;
      await sleep(1_500);
    }
  }

  pos = await readPosition(tokenId);
  if (!sameAddress(pos.owner, WALLET)) {
    await sleep(5_000);
    pos = await readPosition(tokenId);
  }
  if (!sameAddress(pos.owner, WALLET)) throw new Error(`cannot manage #${tokenId}, owner=${pos.owner}`);

  if (pos.liquidity > 0n) {
    await simulateAndSend({
      address: CONTRACTS.nftManager,
      abi: nftManagerAbi,
      functionName: 'decreaseLiquidity',
      args: [{ tokenId: BigInt(tokenId), liquidity: pos.liquidity, amount0Min: 0n, amount1Min: 0n, deadline: unixDeadline() }],
      label: `Decrease ${label}`,
    });
  }

  await simulateAndSend({
    address: CONTRACTS.nftManager,
    abi: nftManagerAbi,
    functionName: 'collect',
    args: [{ tokenId: BigInt(tokenId), recipient: WALLET, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
    label: `Collect ${label}`,
  });

  let burned = false;
  try {
    const after = await readPosition(tokenId);
    if (after.liquidity === 0n && after.tokensOwed0 === 0n && after.tokensOwed1 === 0n) {
      await simulateAndSend({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'burn', args: [BigInt(tokenId)], label: `Burn ${label}` });
      burned = true;
    } else {
      console.log(`burn skipped for #${tokenId}: liquidity=${after.liquidity} owed0=${after.tokensOwed0} owed1=${after.tokensOwed1}`);
    }
  } catch (error) {
    console.log(`burn skipped for #${tokenId}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { exited: true, burned };
}

async function stakeManagedPosition(tokenId, label = `NFT #${tokenId}`) {
  let pos = await readPosition(tokenId);
  if (!isManagedPoolPosition(pos)) throw new Error(`position identity mismatch for #${tokenId}`);
  if (!sameAddress(pos.owner, WALLET)) throw new Error(`cannot stake #${tokenId}, owner=${pos.owner}`);
  if (pos.liquidity <= 0n) throw new Error(`cannot stake #${tokenId}, zero liquidity`);
  const pool = await readPool();
  if (rangeState(pool.currentTick, pos.tickLower, pos.tickUpper) !== 'IN_RANGE') throw new Error(`cannot stake #${tokenId}, out of range at tick ${pool.currentTick}`);
  await simulateAndSend({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'approve', args: [CONTRACTS.gauge, BigInt(tokenId)], label: `Approve ${label} to gauge` });
  await simulateAndSend({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'deposit', args: [BigInt(tokenId)], label: `Stake ${label}` });
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const [owner, contains] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'ownerOf', args: [BigInt(tokenId)] }),
      stakedContains(tokenId),
    ]);
    if (sameAddress(owner, CONTRACTS.gauge) && contains === true) return { staked: true, tokenId };
    await sleep(1_500);
  }
  throw new Error(`stake verification timed out for #${tokenId}`);
}

async function cleanupOrphanPositions(exceptTokenId) {
  const pool = await readPool();
  const closed = [];
  for (const tokenId of candidateManagedTokenIds()) {
    if (tokenId === exceptTokenId) continue;
    const pos = await readPositionMaybe(tokenId);
    if (!isManagedPoolPosition(pos)) continue;
    const walletOwned = sameAddress(pos.owner, WALLET);
    const gaugeOwnedByWallet = sameAddress(pos.owner, CONTRACTS.gauge) && await stakedContains(tokenId);
    const managedByWallet = walletOwned || gaugeOwnedByWallet;
    if (!managedByWallet) continue;
    const state = rangeState(pool.currentTick, pos.tickLower, pos.tickUpper);
    const emptyWalletNft = walletOwned && pos.liquidity === 0n && pos.tokensOwed0 === 0n && pos.tokensOwed1 === 0n;
    if (walletOwned && state === 'IN_RANGE' && pos.liquidity > 0n) {
      await stakeManagedPosition(tokenId, `orphan/in-range NFT #${tokenId}`);
      closed.push({ tokenId, state, action: 'staked_existing', range: { lowerTick: pos.tickLower, upperTick: pos.tickUpper } });
    } else if (state !== 'IN_RANGE' || emptyWalletNft) {
      await closeManagedPosition(tokenId, `orphan/out-of-range NFT #${tokenId}`);
      closed.push({ tokenId, state, action: 'closed', range: { lowerTick: pos.tickLower, upperTick: pos.tickUpper } });
    }
  }
  return closed;
}

function idleTokenUsdValue(status) {
  const tick = Number(status.pool?.currentTick);
  if (!Number.isFinite(tick)) return 0;
  const lfi = Number(formatUnits(BigInt(status.balances?.lfi || 0), 18));
  const usdc = Number(formatUnits(BigInt(status.balances?.usdc || 0), 6));
  return lfi * tickPrice(tick) + usdc;
}

async function ethGasReserveWeiForUsd() {
  if (!Number.isFinite(ETH_GAS_RESERVE_USD) || ETH_GAS_RESERVE_USD <= 0) return 0n;
  const quoteAmount = 1_000_000_000_000_000n; // 0.001 ETH quote sample.
  const route = await bestWethUsdcPath(quoteAmount);
  const quoteUsd = Number(formatUnits(route.out, 6));
  if (!Number.isFinite(quoteUsd) || quoteUsd <= 0) throw new Error(`invalid ETH/USDC gas reserve quote: ${route.out}`);
  const reserveWei = BigInt(Math.ceil((ETH_GAS_RESERVE_USD / quoteUsd) * Number(quoteAmount)));
  return reserveWei > 0n ? reserveWei : 1n;
}

async function convertEthExcessToUsdc() {
  const balances = await readBalances();
  const reserveWei = await ethGasReserveWeiForUsd();
  if (balances.eth <= reserveWei + MIN_ETH_SWAP_WEI) return { spentEth: 0n, usdcOut: 0n, reserveWei: reserveWei.toString(), reserveUsd: ETH_GAS_RESERVE_USD };
  const spend = balances.eth - reserveWei;
  const route = await bestWethUsdcPath(spend);
  const spendUsd = Number(formatUnits(route.out, 6));
  if (!Number.isFinite(spendUsd) || spendUsd < MIN_ETH_SWAP_USD) return { spentEth: 0n, usdcOut: 0n, reserveWei: reserveWei.toString(), reserveUsd: ETH_GAS_RESERVE_USD, skipped: 'below_min_eth_swap_usd', spendUsd };
  const minOut = slippageMin(route.out);
  const out = await swapExactInput(route.path, spend, minOut, spend, `Swap ETH to USDC via WETH/USDC-${route.spacing}`);
  return { spentEth: spend, usdcOut: out, spacing: route.spacing, reserveWei: reserveWei.toString(), reserveUsd: ETH_GAS_RESERVE_USD, spendUsd };
}

async function balanceInventoryToRange(currentTick, lowerTick, upperTick) {
  const balances = await readBalances();
  const price = tickPrice(currentTick);
  const lfi = Number(formatUnits(balances.lfi, 18));
  const usdc = Number(formatUnits(balances.usdc, 6));
  const currentLfiUsd = lfi * price;
  const totalUsd = currentLfiUsd + usdc;
  const fractions = unitRangeFractions(currentTick, lowerTick, upperTick);
  const targetLfiUsd = totalUsd * fractions.lfiFrac;
  const diffUsd = targetLfiUsd - currentLfiUsd;

  if (Math.abs(diffUsd) < MIN_REBALANCE_USD) return { action: 'balanced', totalUsd, currentLfiUsd, targetLfiUsd, fractions };

  if (diffUsd > 0) {
    const spendUsdc = BigInt(Math.max(0, Math.floor(Math.min(diffUsd * 1.02, usdc) * 1e6)));
    if (spendUsdc > 10_000n) {
      await ensureAllowance(CONTRACTS.usdc, CONTRACTS.router, spendUsdc, 'USDC', 'Approve router');
      const p = encodePath([CONTRACTS.usdc, CONTRACTS.lfi], [TICK_SPACING]);
      const quote = await quoteExactInput(p, spendUsdc);
      await swapExactInput(p, spendUsdc, slippageMin(quote), 0n, 'Balance USDC to LFI');
      return { action: 'bought_lfi', spendUsdc: spendUsdc.toString(), quoteLfi: quote.toString(), totalUsd, currentLfiUsd, targetLfiUsd, fractions };
    }
  } else {
    const sellLfiHuman = Math.min((-diffUsd / price) * 1.02, lfi);
    const sellLfi = BigInt(Math.max(0, Math.floor(sellLfiHuman * 1e18)));
    if (sellLfi > 10_000_000_000_000_000n) {
      await ensureAllowance(CONTRACTS.lfi, CONTRACTS.router, sellLfi, 'LFI', 'Approve router');
      const p = encodePath([CONTRACTS.lfi, CONTRACTS.usdc], [TICK_SPACING]);
      const quote = await quoteExactInput(p, sellLfi);
      await swapExactInput(p, sellLfi, slippageMin(quote), 0n, 'Balance LFI to USDC');
      return { action: 'sold_lfi', sellLfi: sellLfi.toString(), quoteUsdc: quote.toString(), totalUsd, currentLfiUsd, targetLfiUsd, fractions };
    }
  }

  return { action: 'balance_skip_small', totalUsd, currentLfiUsd, targetLfiUsd, fractions };
}

async function mintAndStake(lowerTick, upperTick) {
  const pool = await readPool();
  if (rangeState(pool.currentTick, lowerTick, upperTick) !== 'IN_RANGE') {
    throw new Error(`stale mint range ${lowerTick}-${upperTick} for current tick ${pool.currentTick}`);
  }
  let before = await readBalances();
  const amount0Desired = (before.lfi * 999n) / 1000n;
  const amount1Desired = (before.usdc * 999n) / 1000n;
  if (amount0Desired === 0n || amount1Desired === 0n) throw new Error(`insufficient mint inventory lfi=${before.lfi} usdc=${before.usdc}`);

  await ensureAllowance(CONTRACTS.lfi, CONTRACTS.nftManager, amount0Desired, 'LFI', 'Approve NPM');
  await ensureAllowance(CONTRACTS.usdc, CONTRACTS.nftManager, amount1Desired, 'USDC', 'Approve NPM');

  const baseParams = {
    token0: CONTRACTS.lfi,
    token1: CONTRACTS.usdc,
    tickSpacing: TICK_SPACING,
    tickLower: lowerTick,
    tickUpper: upperTick,
    amount0Desired,
    amount1Desired,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: WALLET,
    deadline: unixDeadline(),
    sqrtPriceX96: 0n,
  };
  const sim = await publicClient.simulateContract({ account, address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'mint', args: [baseParams], chain: base });
  const [simTokenId, simLiquidity, simAmount0, simAmount1] = sim.result;
  const simUsd = positionUsdValue({ lfiRaw: simAmount0, usdcRaw: simAmount1, tick: pool.currentTick });
  if (simLiquidity === 0n || simAmount0 === 0n || simAmount1 === 0n || simUsd < MIN_POSITION_USD) {
    throw new Error(`mint sim below minimum liquidity/amounts: liquidity=${simLiquidity} amount0=${simAmount0} amount1=${simAmount1} usd=${simUsd.toFixed(6)}`);
  }

  const params = { ...baseParams, amount0Min: slippageMin(simAmount0), amount1Min: slippageMin(simAmount1), deadline: unixDeadline() };
  const { receipt, hash } = await simulateAndSend({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'mint', args: [params], label: `Mint one-tick NFT sim#${simTokenId}` });
  const transferLogs = parseEventLogs({ abi: nftManagerAbi, logs: receipt.logs, eventName: 'Transfer', strict: false });
  const mintLog = transferLogs.find((log) => sameAddress(log.args.from, ZERO) && sameAddress(log.args.to, WALLET));
  const newTokenId = mintLog?.args?.tokenId ?? simTokenId;
  const mintTx = txs.find((tx) => tx.hash === hash);
  if (mintTx) mintTx.label = `Mint one-tick NFT #${newTokenId}`;
  writeJson(STATE_PATH, { status: 'MINTED_PENDING_STAKE', at: nowIso(), tokenId: newTokenId, range: { lowerTick, upperTick }, mintHash: hash, txs });

  const afterMint = await readBalances();
  const used0 = before.lfi - afterMint.lfi;
  const used1 = before.usdc - afterMint.usdc;

  const beforeStakePool = await readPool();
  const mintedPos = await readPosition(newTokenId);
  if (rangeState(beforeStakePool.currentTick, mintedPos.tickLower, mintedPos.tickUpper) !== 'IN_RANGE') {
    await closeManagedPosition(Number(newTokenId), `fresh out-of-range NFT #${newTokenId}`);
    throw new Error(`fresh mint #${newTokenId} moved out of range before stake at tick ${beforeStakePool.currentTick}`);
  }

  try {
    await simulateAndSend({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'approve', args: [CONTRACTS.gauge, newTokenId], label: `Approve NFT #${newTokenId} to gauge` });
    await simulateAndSend({ address: CONTRACTS.gauge, abi: gaugeAbi, functionName: 'deposit', args: [newTokenId], label: `Stake NFT #${newTokenId}` });
  } catch (error) {
    writeJson(STATE_PATH, { status: 'STAKE_FAILED_CLEANUP_PENDING', at: nowIso(), tokenId: newTokenId, error: error instanceof Error ? error.message : String(error), txs });
    try {
      const failedPos = await readPosition(newTokenId);
      if (sameAddress(failedPos.owner, WALLET)) await closeManagedPosition(Number(newTokenId), `unstaked failed NFT #${newTokenId}`);
    } catch (cleanupError) {
      console.log(`failed stake cleanup skipped for #${newTokenId}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    throw error;
  }

  let verifiedOwner;
  let verifiedStake;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    [verifiedOwner, verifiedStake] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.nftManager, abi: nftManagerAbi, functionName: 'ownerOf', args: [newTokenId] }),
      stakedContains(newTokenId),
    ]);
    if (sameAddress(verifiedOwner, CONTRACTS.gauge) && verifiedStake === true) break;
    await sleep(1_500);
  }
  if (!sameAddress(verifiedOwner, CONTRACTS.gauge) || verifiedStake !== true) throw new Error(`post-stake verification failed owner=${verifiedOwner} staked=${verifiedStake}`);

  return { newTokenId, mintHash: hash, used0, used1, simLiquidity, simAmount0, simAmount1 };
}

function dashboardSyncRequestFilename(newTokenId, timestamp) {
  const token = newTokenId == null ? 'unknown' : String(newTokenId);
  const safeTimestamp = timestamp.replace(/[^0-9A-Za-z-]/g, '-');
  return `${safeTimestamp}-token-${token}-pid-${process.pid}.json`;
}

function writeDashboardSyncRequest({ oldTokenId, newTokenId, lowerTick, upperTick, currentTick, used0, used1, cycleTxs }) {
  const timestamp = nowIso();
  const requestPath = path.join(DASHBOARD_SYNC_REQUEST_DIR, dashboardSyncRequestFilename(newTokenId, timestamp));
  const request = {
    timestamp,
    oldTokenId: oldTokenId == null ? null : oldTokenId.toString(),
    newTokenId: newTokenId == null ? null : newTokenId.toString(),
    lowerTick,
    upperTick,
    currentTick,
    used: {
      lfiRaw: used0 == null ? null : used0.toString(),
      usdcRaw: used1 == null ? null : used1.toString(),
      lfi: used0 == null ? null : fmt(used0, 18, 6),
      usdc: used1 == null ? null : fmt(used1, 6, 6),
    },
    txHashes: cycleTxs.map((tx) => tx.hash),
    txs: cycleTxs.map((tx) => ({ label: tx.label, hash: tx.hash })),
    source: 'aerodrome-one-cron-rebalance',
  };

  let artifactError;
  try {
    mkdirSync(DASHBOARD_SYNC_REQUEST_DIR, { recursive: true });
    writeJson(requestPath, request);
  } catch (error) {
    artifactError = error instanceof Error ? error.message : String(error);
    console.error(`dashboard sync request artifact write failed: ${artifactError}`);
  }

  const result = {
    enabled: false,
    skipped: 'dashboard sync is disabled in LP hot path',
    requestPath,
  };
  if (artifactError) result.artifactError = artifactError;
  return result;
}


async function statusPayload() {
  const pool = await readPool();
  const discovery = await discoverStakedManagedPosition(pool);
  const tokenId = discovery?.tokenId;
  let reward;
  if (tokenId && discovery.stakedContains === true) {
    try {
      reward = await earned(tokenId);
    } catch (error) {
      reward = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const desired = desiredRange(pool.currentTick);
  const balances = await readBalances();
  return {
    at: nowIso(),
    chainId: CHAIN_ID,
    tokenId,
    discovery: {
      mode: 'runtime-onchain',
      candidateCount: candidateManagedTokenIds().length,
      forwardScan: DISCOVERY_FORWARD_SCAN,
    },
    pool,
    desired,
    position: discovery?.position,
    stakedContains: discovery?.stakedContains,
    earned: reward,
    balances,
  };
}

async function rebalance(reason) {
  initSigner();
  txs = [];
  const stateBefore = await statusPayload();
  const oldTokenId = stateBefore.tokenId;
  const cleanup = await cleanupOrphanPositions(oldTokenId);

  if (oldTokenId) await exitOldPosition(oldTokenId);
  await convertEthExcessToUsdc();

  let planningPool = await readPool();
  let target = desiredRange(planningPool.currentTick);
  const balanceActions = [];
  balanceActions.push(await balanceInventoryToRange(planningPool.currentTick, target.lowerTick, target.upperTick));

  planningPool = await readPool();
  const latestTarget = desiredRange(planningPool.currentTick);
  if (latestTarget.lowerTick !== target.lowerTick || latestTarget.upperTick !== target.upperTick) {
    target = latestTarget;
    balanceActions.push(await balanceInventoryToRange(planningPool.currentTick, target.lowerTick, target.upperTick));
  }

  const mint = await mintAndStake(target.lowerTick, target.upperTick);
  const repo = writeDashboardSyncRequest({ oldTokenId, newTokenId: mint.newTokenId, lowerTick: target.lowerTick, upperTick: target.upperTick, currentTick: planningPool.currentTick, used0: mint.used0, used1: mint.used1, cycleTxs: txs });
  const stateAfter = await statusPayload();
  const result = {
    status: 'REBALANCED',
    reason,
    oldTokenId,
    newTokenId: mint.newTokenId.toString(),
    range: target,
    used: { lfiRaw: mint.used0.toString(), usdcRaw: mint.used1.toString(), lfi: fmt(mint.used0, 18, 6), usdc: fmt(mint.used1, 6, 6) },
    balanceAction: balanceActions.at(-1),
    balanceActions,
    cleanup,
    txs,
    repo,
    before: stateBefore,
    after: stateAfter,
    at: nowIso(),
  };
  writeJson(STATE_PATH, result);
  console.log(stringifyJson(result));
  return result;
}

async function decideAndMaybeRun() {
  const status = await statusPayload();
  const pos = status.position;
  let reason = '';
  if (!status.tokenId || !pos || pos.error) {
    reason = `missing/unreadable managed position: ${pos?.error || 'none'}`;
  } else if (!sameAddress(pos.owner, CONTRACTS.gauge) || status.stakedContains !== true) {
    reason = `stake custody mismatch owner=${pos.owner} staked=${status.stakedContains}`;
  } else if (pos.tickLower !== status.desired.lowerTick || pos.tickUpper !== status.desired.upperTick) {
    reason = `range ${pos.tickLower}-${pos.tickUpper} != desired ${status.desired.lowerTick}-${status.desired.upperTick}`;
  } else if (rangeState(status.pool.currentTick, pos.tickLower, pos.tickUpper) !== 'IN_RANGE') {
    reason = `out of range at tick ${status.pool.currentTick}`;
  } else {
    const idleUsd = idleTokenUsdValue(status);
    if (idleUsd >= IDLE_REDEPLOY_USD) reason = `idle capital ${idleUsd.toFixed(4)} USD >= redeploy threshold ${IDLE_REDEPLOY_USD}`;
  }

  if (!reason) {
    const hold = { status: 'HOLD', at: nowIso(), statusSnapshot: status };
    writeJson(STATE_PATH, hold);
    console.log(stringifyJson(hold));
    return hold;
  }

  const cooldownApplies = (reason.startsWith('range ') || reason.startsWith('out of range') || reason.startsWith('idle capital')) && recentRebalanceAgeSeconds() < REBALANCE_COOLDOWN_SECONDS;
  if (cooldownApplies) {
    const hold = { status: 'HOLD_COOLDOWN', reason, cooldownSeconds: REBALANCE_COOLDOWN_SECONDS, at: nowIso(), statusSnapshot: status };
    writeJson(STATE_PATH, hold);
    console.log(stringifyJson(hold));
    return hold;
  }

  if (process.env.HERMES_LP_EXECUTE !== '1') {
    const blocked = { status: 'EXECUTION_BLOCKED', reason, at: nowIso(), note: 'Set HERMES_LP_EXECUTE=1 inside the one cron job to execute.', statusSnapshot: status };
    writeJson(STATE_PATH, blocked);
    console.log(stringifyJson(blocked));
    return blocked;
  }

  return rebalance(reason);
}

async function main() {
  ensureRunDir();
  const statusOnly = process.argv.includes('--status');
  if (statusOnly) {
    console.log(stringifyJson(await statusPayload()));
    return;
  }
  acquireLock();
  try {
    await decideAndMaybeRun();
  } catch (error) {
    const failure = { status: 'ERROR', at: nowIso(), error: error instanceof Error ? error.stack || error.message : String(error) };
    writeJson(STATE_PATH, failure);
    console.error(stringifyJson(failure));
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

await main();
