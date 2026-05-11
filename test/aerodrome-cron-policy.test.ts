import { describe, expect, it } from 'vitest';
import launchdPlist from '../ops/launchd/com.clawberto.aerodrome.onecron.plist?raw';
import cronScript from '../scripts/aerodrome-one-cron-rebalance.mjs?raw';
import launchdWrapper from '../scripts/aerodrome-one-cron-launchd.sh?raw';

function functionBody(name: string): string {
  const marker = `function ${name}`;
  const start = cronScript.indexOf(marker);
  expect(start, `${name}() should exist`).toBeGreaterThanOrEqual(0);

  const bodyOpen = cronScript.indexOf(') {', start) + 2;
  expect(bodyOpen, `${name}() should have a body`).toBeGreaterThanOrEqual(2);

  let depth = 0;
  let entered = false;
  for (let i = bodyOpen; i < cronScript.length; i += 1) {
    const char = cronScript[i];
    if (char === '{') {
      depth += 1;
      entered = true;
    } else if (char === '}') {
      depth -= 1;
      if (entered && depth === 0) return cronScript.slice(start, i + 1);
    }
  }
  throw new Error(`Unable to parse ${name}() body`);
}

describe('Aerodrome one-cron operational policy', () => {
  it('keeps dashboard/GitHub sync out of the rebalance hot path by default', () => {
    const rebalanceBody = functionBody('rebalance');

    expect(cronScript).toContain("const DASHBOARD_SYNC_ENABLED = process.env.HERMES_DASHBOARD_SYNC === '1';");
    expect(rebalanceBody).not.toContain('updatePositionsTs(');
    expect(rebalanceBody).not.toContain('commitAndPush(');
    expect(rebalanceBody).toContain('syncDashboardIfEnabled(');
  });

  it('does not use hardcoded dashboard positions as active-candidate input unless explicitly enabled', () => {
    const candidateBody = functionBody('candidateManagedTokenIds');

    expect(candidateBody).toContain('INCLUDE_DASHBOARD_CANDIDATES');
    expect(candidateBody).not.toMatch(/path\.join\(REPO,\s*'src',\s*'positions\.ts'\),/);
  });

  it('adds an explicit gas safety buffer to simulated writes', () => {
    const simulateBody = functionBody('simulateAndSend');

    expect(cronScript).toContain('function bufferedGasLimit');
    expect(simulateBody).toContain('estimateContractGas');
    expect(simulateBody).toContain('bufferedGasLimit');
    expect(simulateBody).toContain('writeContract({ ...request, gas })');
  });

  it('keeps launchd cadence at 60 seconds to reduce system/RPC pressure', () => {
    expect(launchdPlist).toContain('<key>StartInterval</key>');
    expect(launchdPlist.match(/<key>StartInterval<\/key>/g)).toHaveLength(1);
    expect(launchdPlist).toContain('<integer>60</integer>');
    expect(launchdPlist).not.toContain('<integer>30</integer>');
  });

  it('does not run git synchronization from the 60-second launchd loop', () => {
    expect(launchdWrapper).not.toMatch(/git\s+(pull|status|push|commit|add)\b/);
    expect(launchdWrapper).toContain('node scripts/aerodrome-one-cron-rebalance.mjs --cron');
  });
});
