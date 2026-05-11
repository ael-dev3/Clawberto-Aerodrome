import { describe, expect, it } from 'vitest';
import launchdPlist from '../ops/launchd/com.clawberto.aerodrome.onecron.plist?raw';
import cronScript from '../scripts/aerodrome-one-cron-rebalance.mjs?raw';
import releaseSyncScript from '../scripts/aerodrome-dashboard-release-sync.mjs?raw';
import launchdWrapper from '../scripts/aerodrome-one-cron-launchd.sh?raw';
import watcherScript from '../scripts/aerodrome-lp-watcher.mjs?raw';
import supervisorPrecheck from '../scripts/aerodrome-lp-supervisor-precheck.py?raw';

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name}() should exist`).toBeGreaterThanOrEqual(0);

  const paramsOpen = source.indexOf('(', start);
  expect(paramsOpen, `${name}() should have parameters`).toBeGreaterThanOrEqual(0);

  let paramsDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsClose = i;
        break;
      }
    }
  }

  const bodyOpen = source.indexOf('{', paramsClose);
  expect(bodyOpen, `${name}() should have a body`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let i = bodyOpen; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unable to parse ${name}() body`);
}

const hotPathForbidden = [
  ['dashboard sync env gate', /HERMES_DASHBOARD_SYNC/],
  ['execSync shell helper', /\bexecSync\b/],
  ['npm test/build command', /npm\s+(test|run\s+build)\b/],
  ['git repository command', /git\s+(add|commit|push|pull|rebase|rev-parse|status)\b/],
  ['GitHub CLI run command', /gh\s+run\b/],
  ['Pages deployment/watch logic', /(GitHub Pages|Deploy GitHub Pages|Pages watch|LIVE_URL|OWNER_REPO|ael-dev3\.github\.io)/],
  ['deployment HTTP curl verification', /curl\s+-/],
  ['repo-mutating dashboard updater', /(updatePositionsTs|commitAndPush|src['"]\s*,\s*['"]positions\.ts)/],
];

function expectNoForbiddenHotPath(source: string): void {
  for (const [label, pattern] of hotPathForbidden) {
    expect(source, `LP runtime must not contain ${label}`).not.toMatch(pattern as RegExp);
  }
}

describe('Aerodrome one-cron operational policy', () => {
  it('keeps repository/build/deploy/GitHub Pages capability out of the LP runtime hot path', () => {
    expectNoForbiddenHotPath(cronScript);
    expect(cronScript).not.toContain('aerodrome-dashboard-release-sync');
  });

  it('cannot be made to run dashboard repo sync by setting HERMES_DASHBOARD_SYNC', () => {
    expect(cronScript).not.toContain('process.env.HERMES_DASHBOARD_SYNC');
    expect(cronScript).not.toContain('DASHBOARD_SYNC_ENABLED');
    expect(cronScript).not.toContain('syncDashboardIfEnabled');
    expect(cronScript).not.toContain('updatePositionsTs(');
    expect(cronScript).not.toContain('commitAndPush(');
  });

  it('writes an artifact-only dashboard sync request after a rebalance', () => {
    const rebalanceBody = functionBody(cronScript, 'rebalance');
    const requestBody = functionBody(cronScript, 'writeDashboardSyncRequest');

    expect(cronScript).toContain("const DASHBOARD_SYNC_REQUEST_DIR = path.join(REPO, 'runs', 'aerodrome-dashboard-sync');");
    expect(requestBody).toContain('writeJson(requestPath, request);');
    expect(requestBody).toContain("skipped: 'dashboard sync is disabled in LP hot path'");
    expect(requestBody).toContain('oldTokenId: oldTokenId == null ? null : oldTokenId.toString()');
    expect(requestBody).toContain('newTokenId: newTokenId == null ? null : newTokenId.toString()');
    expect(requestBody).toContain('lowerTick');
    expect(requestBody).toContain('upperTick');
    expect(requestBody).toContain('currentTick');
    expect(requestBody).toContain('used: {');
    expect(requestBody).toContain('txHashes: cycleTxs.map((tx) => tx.hash)');
    expect(rebalanceBody).toContain('const repo = writeDashboardSyncRequest(');
    expect(rebalanceBody).not.toContain('updatePositionsTs(');
    expect(rebalanceBody).not.toContain('commitAndPush(');
  });

  it('does not use hardcoded dashboard positions as active-candidate input', () => {
    const candidateBody = functionBody(cronScript, 'candidateManagedTokenIds');

    expect(cronScript).not.toContain('dashboardManagedTokenIds');
    expect(cronScript).not.toContain('HERMES_INCLUDE_DASHBOARD_CANDIDATES');
    expect(candidateBody).not.toContain('positions.ts');
    expect(candidateBody).not.toMatch(/path\.join\(REPO,\s*'src',\s*'positions\.ts'\)/);
  });

  it('keeps dashboard release sync separate from watcher/precheck/rebalance hot paths', () => {
    expect(releaseSyncScript).toContain('function updatePositionsTs');
    expect(releaseSyncScript).toContain("run('npm', ['test']");
    expect(releaseSyncScript).toContain("run('npm', ['run', 'build']");
    expect(releaseSyncScript).toContain("run('git', ['add', 'src/positions.ts'");
    expect(releaseSyncScript).toContain("run('gh', ['run', 'list'");
    expect(releaseSyncScript).toContain("run('gh', ['run', 'watch'");
    expect(releaseSyncScript).toContain("run('curl', ['-sS', '-L'");

    for (const [name, source] of [
      ['rebalance runtime', cronScript],
      ['watcher', watcherScript],
      ['supervisor precheck', supervisorPrecheck],
      ['retired launchd wrapper', launchdWrapper],
    ] as const) {
      expect(source, `${name} must not import/call release sync`).not.toContain('aerodrome-dashboard-release-sync');
    }
  });

  it('adds an explicit gas safety buffer to simulated writes', () => {
    const simulateBody = functionBody(cronScript, 'simulateAndSend');

    expect(cronScript).toContain('function bufferedGasLimit');
    expect(simulateBody).toContain('estimateContractGas');
    expect(simulateBody).toContain('bufferedGasLimit');
    expect(simulateBody).toContain('writeContract({ ...request, gas })');
  });

  it('uses a USD gas reserve and idle-capital trigger so most liquidity can be redeployed', () => {
    expect(cronScript).toContain('HERMES_ETH_GAS_RESERVE_USD');
    expect(cronScript).toContain("process.env.HERMES_ETH_GAS_RESERVE_USD || '1.5'");
    expect(cronScript).toContain('HERMES_IDLE_REDEPLOY_USD');
    expect(cronScript).toContain("process.env.HERMES_IDLE_REDEPLOY_USD || '2'");
    expect(cronScript).toContain('idleTokenUsdValue');
    expect(cronScript).toContain('idle capital');
  });

  it('defaults slippage to the strict 30 bps policy instead of 2000 bps', () => {
    expect(cronScript).toContain("const SLIPPAGE_BPS = BigInt(process.env.HERMES_SLIPPAGE_BPS || '30');");
    expect(cronScript).not.toContain("HERMES_SLIPPAGE_BPS || '2000'");
  });

  it('keeps launchd cadence at 60 seconds to reduce system/RPC pressure', () => {
    expect(launchdPlist).toContain('<key>StartInterval</key>');
    expect(launchdPlist.match(/<key>StartInterval<\/key>/g)).toHaveLength(1);
    expect(launchdPlist).toContain('<integer>60</integer>');
    expect(launchdPlist).not.toContain('<integer>30</integer>');
  });

  it('retires the old launchd executor so Hermes is not the tight rebalance loop', () => {
    expect(launchdPlist).toContain('<key>Disabled</key>');
    expect(launchdWrapper).not.toMatch(/git\s+(pull|status|push|commit|add)\b/);
    expect(launchdWrapper).not.toContain('--cron');
    expect(launchdWrapper).toContain('retired');
  });
});
