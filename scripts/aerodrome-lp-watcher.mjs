#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const RUN_DIR = path.join(REPO, 'runs', 'aerodrome-lp-supervisor');
const STATE_PATH = path.join(RUN_DIR, 'state.json');
const HEARTBEAT_PATH = path.join(RUN_DIR, 'watcher-heartbeat.json');
const LOCK_PATH = path.join(RUN_DIR, 'watcher.lock');
const ACTION_STATE_PATH = path.join(RUN_DIR, 'last-action.json');
const ONE_CRON_STATE_PATH = path.join(REPO, 'runs', 'aerodrome-one-cron', 'state.json');
const STATUS_COMMAND_TIMEOUT_MS = 45_000;

const POLICY = {
  poll_seconds: 15,
  hermes_supervisor_schedule: 'every 1m',
  action_state_max_age_seconds: 20,
  alert_state_max_age_seconds: 60,
  min_rebalance_cooldown_seconds: 600,
  max_actions_per_run: 1,
  edge_trigger: {
    mode: 'range_aware',
    trigger_at_percent_of_half_width: 0.20,
    hard_exit_at_percent_of_half_width: 0.05,
  },
  execution_guards: {
    gas_reserve_usd: 1.5,
    idle_redeploy_threshold_usd: 2.0,
    min_fee_to_cost_ratio: 3.0,
    max_slippage_bps: 30,
    require_quote_freshness_seconds: 10,
  },
};

function nowIso() { return new Date().toISOString(); }
function stringifyJson(value) { return JSON.stringify(value, null, 2); }
function ensureRunDir() { mkdirSync(RUN_DIR, { recursive: true }); }
function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  ensureRunDir();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${stringifyJson(value)}\n`);
  renameSync(tmp, file);
}
function writeHeartbeat(value) { writeJsonAtomic(HEARTBEAT_PATH, value); }
function previousSuccessAt() {
  const state = readJson(STATE_PATH, null);
  return state?.last_success_at || state?.watcher_finished_at || state?.at || null;
}
function previousConsecutiveErrors() {
  const heartbeat = readJson(HEARTBEAT_PATH, null);
  return Number(heartbeat?.consecutive_errors || 0);
}
function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function acquireLock() {
  ensureRunDir();
  if (existsSync(LOCK_PATH)) {
    const lock = readJson(LOCK_PATH, {});
    const ageMs = Date.now() - Date.parse(lock.at || 0);
    if (pidIsAlive(Number(lock.pid)) && Number.isFinite(ageMs) && ageMs < 120_000) {
      const locked = {
        status: 'LOCKED',
        wakeAgent: false,
        at: nowIso(),
        lock,
        policy: POLICY,
        last_success_at: previousSuccessAt(),
        consecutive_errors: previousConsecutiveErrors(),
      };
      writeHeartbeat(locked);
      console.log(stringifyJson(locked));
      process.exit(0);
    }
    try { unlinkSync(LOCK_PATH); } catch {}
  }
  writeJsonAtomic(LOCK_PATH, { at: nowIso(), pid: process.pid });
}
function releaseLock() { try { unlinkSync(LOCK_PATH); } catch {} }

function runStatus() {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['scripts/aerodrome-one-cron-rebalance.mjs', '--status'],
      {
        cwd: REPO,
        timeout: STATUS_COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, HERMES_LP_EXECUTE: '0', HERMES_DISCOVERY_FORWARD_SCAN: '0' },
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.end();
  });
}

function tickPrice(tick) { return Math.pow(1.0001, tick) * 1e12; }

function latestActionAgeSeconds() {
  const explicit = readJson(ACTION_STATE_PATH, null);
  const oneCron = readJson(ONE_CRON_STATE_PATH, null);
  const candidates = [explicit, oneCron]
    .filter(Boolean)
    .filter((state) => ['REBALANCED', 'REMEDIATED', 'ACTION_EXECUTED'].includes(state.status))
    .map((state) => Date.parse(state.at))
    .filter((ms) => Number.isFinite(ms));
  if (!candidates.length) return Infinity;
  return (Date.now() - Math.max(...candidates)) / 1000;
}

function positionUsdValueFromStatus(status, currentTick) {
  const position = status.position || {};
  const lowerTick = Number(position.tickLower);
  const upperTick = Number(position.tickUpper);
  const liquidity = Number(position.liquidity || 0);
  if (!Number.isFinite(currentTick) || !Number.isFinite(lowerTick) || !Number.isFinite(upperTick) || !Number.isFinite(liquidity) || liquidity <= 0) return 0;
  const sqrtLower = Math.sqrt(Math.pow(1.0001, lowerTick));
  const sqrtUpper = Math.sqrt(Math.pow(1.0001, upperTick));
  const sqrtCurrent = Math.sqrt(Math.pow(1.0001, currentTick));
  let token0Raw = 0;
  let token1Raw = 0;
  if (currentTick < lowerTick) token0Raw = liquidity * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
  else if (currentTick >= upperTick) token1Raw = liquidity * (sqrtUpper - sqrtLower);
  else {
    token0Raw = liquidity * (sqrtUpper - sqrtCurrent) / (sqrtCurrent * sqrtUpper);
    token1Raw = liquidity * (sqrtCurrent - sqrtLower);
  }
  const lfi = token0Raw / 1e18;
  const usdc = token1Raw / 1e6;
  return lfi * tickPrice(currentTick) + usdc;
}

function idleTokenUsdFromStatus(status, currentTick) {
  if (!Number.isFinite(currentTick)) return 0;
  const lfiRaw = BigInt(status.balances?.lfi || 0);
  const usdcRaw = BigInt(status.balances?.usdc || 0);
  return Number(lfiRaw) / 1e18 * tickPrice(currentTick) + Number(usdcRaw) / 1e6;
}

function analyzeStatus(status, runHealth) {
  const statusAtMs = Date.parse(status.at || 0);
  const status_age_seconds = Number.isFinite(statusAtMs) ? Math.max(0, (Date.now() - statusAtMs) / 1000) : Infinity;
  const currentTick = Number(status.pool?.currentTick);
  const lowerTick = Number(status.position?.tickLower);
  const upperTick = Number(status.position?.tickUpper);
  const halfWidthTicks = (upperTick - lowerTick) / 2;
  const inRange = Number.isFinite(currentTick) && Number.isFinite(lowerTick) && Number.isFinite(upperTick)
    && currentTick >= lowerTick && currentTick < upperTick;
  const distanceToLowerTicks = Number.isFinite(currentTick) && Number.isFinite(lowerTick) ? currentTick - lowerTick : null;
  const distanceToUpperTicks = Number.isFinite(currentTick) && Number.isFinite(upperTick) ? upperTick - currentTick : null;
  const distanceToNearestEdgeTicks = inRange ? Math.min(distanceToLowerTicks, distanceToUpperTicks) : 0;
  const percentOfHalfWidth = inRange && halfWidthTicks > 0 ? distanceToNearestEdgeTicks / halfWidthTicks : 0;
  const desiredMismatch = Number(status.desired?.lowerTick) !== lowerTick || Number(status.desired?.upperTick) !== upperTick;
  const lpUsd = positionUsdValueFromStatus(status, currentTick);
  const idleTokenUsd = idleTokenUsdFromStatus(status, currentTick);
  const idleRedeploy = idleTokenUsd >= POLICY.execution_guards.idle_redeploy_threshold_usd;
  const hardExit = !inRange || percentOfHalfWidth <= POLICY.edge_trigger.hard_exit_at_percent_of_half_width;
  const nearEdge = !inRange || percentOfHalfWidth <= POLICY.edge_trigger.trigger_at_percent_of_half_width || desiredMismatch;
  const lastActionAgeSeconds = latestActionAgeSeconds();
  const cooldownActive = lastActionAgeSeconds < POLICY.min_rebalance_cooldown_seconds;
  const stale = status_age_seconds >= POLICY.action_state_max_age_seconds;
  const missingData = !Number.isFinite(currentTick) || !Number.isFinite(lowerTick) || !Number.isFinite(upperTick) || !status.tokenId;

  const reasons = [];
  if (missingData) reasons.push('missing_status_fields');
  if (stale) reasons.push('status_stale');
  if (!inRange) reasons.push('out_of_range');
  if (desiredMismatch) reasons.push('desired_range_mismatch');
  if (inRange && percentOfHalfWidth <= POLICY.edge_trigger.hard_exit_at_percent_of_half_width) reasons.push('hard_edge_threshold');
  else if (inRange && percentOfHalfWidth <= POLICY.edge_trigger.trigger_at_percent_of_half_width) reasons.push('near_edge_threshold');
  if (idleRedeploy) reasons.push('idle_capital_exceeds_threshold');
  if (cooldownActive) reasons.push('rebalance_cooldown_active');

  const wakeAgent = Boolean(missingData || stale || !inRange || hardExit || ((nearEdge || idleRedeploy) && !cooldownActive));
  const actionRequired = Boolean(wakeAgent && !missingData && !stale && !cooldownActive && (nearEdge || idleRedeploy));
  const recommendedAction = actionRequired
    ? 'STRICT_CLI_REBALANCE_REVIEW'
    : wakeAgent
      ? 'ALERT_REVIEW_ONLY'
      : 'HOLD';

  return {
    status: 'WATCHED',
    at: runHealth.watcher_finished_at,
    watcher_started_at: runHealth.watcher_started_at,
    watcher_finished_at: runHealth.watcher_finished_at,
    status_runtime_ms: runHealth.status_runtime_ms,
    last_success_at: runHealth.watcher_finished_at,
    consecutive_errors: 0,
    status_command_timeout_ms: STATUS_COMMAND_TIMEOUT_MS,
    wakeAgent,
    actionRequired,
    recommendedAction,
    reasons,
    policy: POLICY,
    cooldown: {
      active: cooldownActive,
      last_action_age_seconds: Number.isFinite(lastActionAgeSeconds) ? Math.round(lastActionAgeSeconds) : null,
    },
    capital: {
      lpUsd,
      idleTokenUsd,
      gasReserveUsd: POLICY.execution_guards.gas_reserve_usd,
      idleRedeployThresholdUsd: POLICY.execution_guards.idle_redeploy_threshold_usd,
      idleRedeploy,
    },
    range: {
      tokenId: status.tokenId,
      currentTick,
      lowerTick,
      upperTick,
      desiredLowerTick: status.desired?.lowerTick,
      desiredUpperTick: status.desired?.upperTick,
      inRange,
      desiredMismatch,
      halfWidthTicks,
      distanceToLowerTicks,
      distanceToUpperTicks,
      distanceToNearestEdgeTicks,
      percentOfHalfWidth,
      triggerAtPercentOfHalfWidth: POLICY.edge_trigger.trigger_at_percent_of_half_width,
      hardExitAtPercentOfHalfWidth: POLICY.edge_trigger.hard_exit_at_percent_of_half_width,
    },
    state_age_seconds: status_age_seconds,
    max_actions_remaining: POLICY.max_actions_per_run,
    source: {
      mode: 'local-deterministic-watcher',
      status_command: 'node scripts/aerodrome-one-cron-rebalance.mjs --status',
      execute_enabled: false,
    },
    statusSnapshot: status,
  };
}

async function main() {
  const startMs = Date.now();
  const watcherStartedAt = nowIso();
  acquireLock();
  const baseHeartbeat = {
    status: 'RUNNING',
    at: watcherStartedAt,
    watcher_started_at: watcherStartedAt,
    status_command_timeout_ms: STATUS_COMMAND_TIMEOUT_MS,
    last_success_at: previousSuccessAt(),
    consecutive_errors: previousConsecutiveErrors(),
    policy: POLICY,
  };
  writeHeartbeat(baseHeartbeat);

  try {
    const stdout = await runStatus();
    const status = JSON.parse(stdout);
    const watcherFinishedAt = nowIso();
    const statusRuntimeMs = Date.now() - startMs;
    const runHealth = {
      watcher_started_at: watcherStartedAt,
      watcher_finished_at: watcherFinishedAt,
      status_runtime_ms: statusRuntimeMs,
    };
    const state = analyzeStatus(status, runHealth);
    const heartbeat = {
      status: 'OK',
      at: watcherFinishedAt,
      watcher_started_at: watcherStartedAt,
      watcher_finished_at: watcherFinishedAt,
      status_runtime_ms: statusRuntimeMs,
      last_success_at: watcherFinishedAt,
      consecutive_errors: 0,
      status_command_timeout_ms: STATUS_COMMAND_TIMEOUT_MS,
      policy: POLICY,
    };
    writeJsonAtomic(STATE_PATH, state);
    writeHeartbeat(heartbeat);
    console.log(stringifyJson(state));
  } catch (error) {
    const watcherFinishedAt = nowIso();
    const consecutiveErrors = previousConsecutiveErrors() + 1;
    const errorHeartbeat = {
      status: 'ERROR',
      at: watcherFinishedAt,
      watcher_started_at: watcherStartedAt,
      watcher_finished_at: watcherFinishedAt,
      status_runtime_ms: Date.now() - startMs,
      wakeAgent: true,
      actionRequired: false,
      recommendedAction: 'ALERT_REVIEW_ONLY',
      reasons: ['watcher_error'],
      policy: POLICY,
      last_success_at: previousSuccessAt(),
      consecutive_errors: consecutiveErrors,
      status_command_timeout_ms: STATUS_COMMAND_TIMEOUT_MS,
      error: String(error?.message || error),
      stdout: error?.stdout?.slice?.(0, 4000) || '',
      stderr: error?.stderr?.slice?.(0, 4000) || '',
    };
    writeHeartbeat(errorHeartbeat);
    console.log(stringifyJson(errorHeartbeat));
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

await main();
