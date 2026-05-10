import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';

import { trackedPositionAddresses } from '../src/rpc';

describe('tracked wallet position addresses', () => {
  it('deduplicates primary wallets and linked LP controllers in order', () => {
    const primary = '0x0000000000000000000000000000000000000001' as Address;
    const controller = '0x0000000000000000000000000000000000000002' as Address;

    expect(trackedPositionAddresses({
      address: primary,
      positionAddresses: [controller, primary],
    })).toEqual([primary, controller]);
  });
});
