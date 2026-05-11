import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';

import { TRACKED_WALLETS } from '../src/config';
import { sumWalletBalances, trackedPositionAddresses } from '../src/rpc';

describe('tracked wallet position addresses', () => {
  it('deduplicates primary wallets and linked LP controllers in order', () => {
    const primary = '0x0000000000000000000000000000000000000001' as Address;
    const controller = '0x0000000000000000000000000000000000000002' as Address;

    expect(trackedPositionAddresses({
      address: primary,
      positionAddresses: [controller, primary],
    })).toEqual([primary, controller]);
  });

  it('sums balances across primary wallets and linked LP controllers', () => {
    expect(sumWalletBalances([
      { eth: 1n, lfi: 2n, usdc: 3n, aero: 4n },
      { eth: 10n, lfi: 20n, usdc: 30n, aero: 40n },
    ])).toEqual({ eth: 11n, lfi: 22n, usdc: 33n, aero: 44n });
  });

  it('returns zero balances for an empty balance group', () => {
    expect(sumWalletBalances([])).toEqual({ eth: 0n, lfi: 0n, usdc: 0n, aero: 0n });
  });

  it('uses operator names for the dashboard wallet labels', () => {
    expect(TRACKED_WALLETS.find((wallet) => wallet.role === 'agent')).toMatchObject({
      label: 'Clawberto wallet',
      shortLabel: 'Clawberto',
    });
    expect(TRACKED_WALLETS.find((wallet) => wallet.role === 'human')).toMatchObject({
      label: 'Ael wallet',
      shortLabel: 'Ael',
    });
  });
});
