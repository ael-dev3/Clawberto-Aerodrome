#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DASHBOARD_SYNC_REQUEST_DIR = path.join(REPO, 'runs', 'aerodrome-dashboard-sync');
const LIVE_URL = 'https://ael-dev3.github.io/Clawberto-Aerodrome/';
const OWNER_REPO = 'ael-dev3/Clawberto-Aerodrome';
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const INTEGER_RE = /^-?\d+$/;
const UINT_RE = /^\d+$/;

function run(command, args = [], opts = {}) {
  return execFileSync(command, args, { cwd: REPO, encoding: 'utf8', stdio: opts.stdio || 'pipe', env: { ...process.env, ...opts.env } });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function latestRequestPath() {
  if (!existsSync(DASHBOARD_SYNC_REQUEST_DIR)) throw new Error(`missing dashboard sync request directory: ${DASHBOARD_SYNC_REQUEST_DIR}`);
  const candidates = readdirSync(DASHBOARD_SYNC_REQUEST_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(DASHBOARD_SYNC_REQUEST_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!candidates.length) throw new Error(`no dashboard sync request artifacts found in ${DASHBOARD_SYNC_REQUEST_DIR}`);
  return candidates[0];
}

function escapeTs(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function rangeLabel(lowerTick, upperTick) {
  return `${lowerTick} to ${upperTick}`;
}

function formatRaw(raw, decimals, digits = 6) {
  if (raw == null) return '0';
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n || digits <= 0) return whole.toString();
  const trimmed = fraction.toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function requireRequestField(request, key) {
  if (request[key] == null || request[key] === '') throw new Error(`dashboard sync request missing ${key}`);
  return request[key];
}

function requireIntegerString(value, label, { unsigned = false } = {}) {
  const text = String(value);
  const pattern = unsigned ? UINT_RE : INTEGER_RE;
  if (!pattern.test(text)) throw new Error(`dashboard sync request ${label} must be ${unsigned ? 'an unsigned integer' : 'an integer'}`);
  return text;
}

function requireTokenId(value, label) {
  const text = requireIntegerString(value, label, { unsigned: true });
  if (BigInt(text) <= 0n) throw new Error(`dashboard sync request ${label} must be positive`);
  return text;
}

function optionalTokenId(value, label) {
  if (value == null || value === '') return null;
  return requireTokenId(value, label);
}

function requireTick(request, key) {
  const text = requireIntegerString(requireRequestField(request, key), key);
  const tick = Number(text);
  if (!Number.isSafeInteger(tick)) throw new Error(`dashboard sync request ${key} is outside safe integer range`);
  return tick;
}

function requireRawAmount(value, label) {
  return requireIntegerString(value ?? '0', label, { unsigned: true });
}

function requireTxHash(value, label) {
  const hash = String(value ?? '');
  if (!TX_HASH_RE.test(hash)) throw new Error(`dashboard sync request ${label} must be a transaction hash`);
  return hash;
}

function txArrayLiteral(cycleTxs) {
  return cycleTxs.map((tx) => `      { label: '${escapeTs(tx.label)}', hash: '${requireTxHash(tx.hash, 'tx.hash')}' },`).join('\n');
}

function normalizedTxs(request) {
  const txs = Array.isArray(request.txs) ? request.txs : [];
  if (txs.length) {
    return txs.map((tx, index) => ({
      label: String(tx?.label || `Tx ${index + 1}`),
      hash: requireTxHash(tx?.hash, `txs[${index}].hash`),
    }));
  }
  return (Array.isArray(request.txHashes) ? request.txHashes : []).map((hash, index) => ({
    label: `Tx ${index + 1}`,
    hash: requireTxHash(hash, `txHashes[${index}]`),
  }));
}

function updatePositionsTs(request) {
  const oldTokenId = optionalTokenId(request.oldTokenId, 'oldTokenId');
  const newTokenId = requireTokenId(requireRequestField(request, 'newTokenId'), 'newTokenId');
  const lowerTick = requireTick(request, 'lowerTick');
  const upperTick = requireTick(request, 'upperTick');
  const currentTick = requireTick(request, 'currentTick');
  const used = request.used || {};
  const used0 = requireRawAmount(used.lfiRaw ?? request.used0 ?? '0', 'used.lfiRaw');
  const used1 = requireRawAmount(used.usdcRaw ?? request.used1 ?? '0', 'used.usdcRaw');
  const cycleTxs = normalizedTxs(request);
  const file = path.join(REPO, 'src', 'positions.ts');
  let src = readFileSync(file, 'utf8');
  const managedMarker = 'export const managedPositions: ManagedPositionRecord[] = [\n';
  const managedAt = src.indexOf(managedMarker);
  const managedEnd = src.indexOf('];', managedAt);
  if (managedAt < 0 || managedEnd < 0) throw new Error('unable to locate managed positions array');
  const date = String(request.timestamp || new Date().toISOString()).slice(0, 10);
  const firstBlock = `  {\n    tokenId: ${newTokenId}n,\n    label: 'Hermes CL200 one-tick band',\n    origin: 'hermes-managed',\n    pair: 'LFI/USDC',\n    pool: CONTRACTS.pool,\n    gauge: CONTRACTS.gauge,\n    nftManager: CONTRACTS.nftManager,\n    depositor: WALLET_ADDRESS,\n    enteredAt: '${escapeTs(date)}',\n    intendedRange: 'One CL200 tick, ${rangeLabel(lowerTick, upperTick)}, rebalanced from tick ${currentTick}',\n    notes: 'Rebalanced by the Hermes Aerodrome LP executor into the active one-tick band and staked into the Aerodrome gauge. Runtime dashboard sync is disabled in the LP hot path; this record was applied by the separate release sync script.',\n    deposited: {\n      lfiRaw: ${used0}n,\n      usdcRaw: ${used1}n,\n    },\n    setupTxs: [\n${txArrayLiteral(cycleTxs)}\n    ],\n  },\n`;
  src = src.slice(0, managedAt + managedMarker.length) + firstBlock + src.slice(managedEnd);

  const exitTx = cycleTxs.find((tx) => tx.label.startsWith('Burn old')) || cycleTxs.find((tx) => tx.label.startsWith('Decrease old')) || cycleTxs.find((tx) => tx.label.startsWith('Withdraw old'));
  const stakeTx = cycleTxs.find((tx) => tx.label.startsWith('Stake NFT')) || cycleTxs[cycleTxs.length - 1];
  const historyEntries = `${oldTokenId ? `  {\n    date: '${escapeTs(date)}',\n    event: 'Exited previous Hermes NFT #${escapeTs(oldTokenId)}',\n    detail: 'LP release sync recorded the previous managed range as exited before entering the current one-tick band.',\n    tokenId: ${oldTokenId}n,\n    tx: '${requireTxHash(exitTx?.hash ?? cycleTxs[0]?.hash ?? '', 'exit tx hash')}',\n  },\n` : ''}  {\n    date: '${escapeTs(date)}',\n    event: 'Entered and staked one-tick NFT #${escapeTs(newTokenId)}',\n    detail: 'Range ${rangeLabel(lowerTick, upperTick)} around tick ${currentTick}. Mint used ${formatRaw(used0, 18, 6)} LFI and ${formatRaw(used1, 6, 6)} USDC.',\n    tokenId: ${newTokenId}n,\n    tx: '${requireTxHash(stakeTx?.hash ?? cycleTxs[cycleTxs.length - 1]?.hash ?? '', 'stake tx hash')}',\n  },\n`;
  const historyMarker = 'export const positionHistory = [\n';
  const historyAt = src.indexOf(historyMarker);
  if (historyAt >= 0) {
    src = src.slice(0, historyAt + historyMarker.length) + historyEntries + src.slice(historyAt + historyMarker.length);
  } else {
    src = `${src.trimEnd()}\n\nexport const positionHistory = [\n${historyEntries}];\n`;
  }
  writeFileSync(file, src);
}

function commitAndPush(newTokenId) {
  run('npm', ['test'], { stdio: 'inherit' });
  run('npm', ['run', 'build'], { stdio: 'inherit' });
  run('git', ['add', 'src/positions.ts', 'scripts/aerodrome-dashboard-release-sync.mjs']);
  try {
    run('git', ['diff', '--cached', '--quiet']);
    return { committed: false };
  } catch {}
  run('git', ['commit', '-m', `chore: sync Aerodrome dashboard LP #${newTokenId}`], { stdio: 'inherit' });
  try {
    run('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
  } catch {
    run('git', ['pull', '--rebase', 'origin', 'main'], { stdio: 'inherit' });
    run('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
  }
  const sha = run('git', ['rev-parse', 'HEAD']).trim();
  let runId;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const json = run('gh', ['run', 'list', '--repo', OWNER_REPO, '--limit', '5', '--json', 'databaseId,headSha,status,workflowName']);
      const match = JSON.parse(json).find((candidate) => candidate?.headSha === sha && candidate?.workflowName === 'Deploy GitHub Pages');
      if (match?.databaseId) {
        runId = match.databaseId;
        break;
      }
    } catch (error) {
      console.log(`Pages run lookup attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    run('sleep', ['3']);
  }
  if (runId) {
    run('gh', ['run', 'watch', String(runId), '--repo', OWNER_REPO, '--exit-status'], { stdio: 'inherit' });
  } else {
    console.log(`Pages watch skipped: no run found for ${sha}`);
  }
  const http = run('curl', ['-sS', '-L', '-o', '/tmp/clawberto-aerodrome-dashboard-release-sync.html', '-w', '%{http_code}', LIVE_URL]).trim();
  if (http !== '200') throw new Error(`live dashboard HTTP ${http}`);
  return { committed: true, sha, runId };
}

function main() {
  const requestPath = path.resolve(argValue('--request') || latestRequestPath());
  const request = readJson(requestPath);
  updatePositionsTs(request);
  const release = commitAndPush(String(request.newTokenId));
  console.log(JSON.stringify({ status: 'DASHBOARD_RELEASE_SYNCED', requestPath, release }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
