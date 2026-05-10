import type { Address } from 'viem';
import { CONTRACTS, WALLET_ADDRESS } from './config';

export type PositionOrigin = 'hermes-managed' | 'ael-existing';

export interface ManagedPositionRecord {
  tokenId: bigint;
  label: string;
  origin: PositionOrigin;
  pair: 'LFI/USDC';
  pool: Address;
  gauge: Address;
  nftManager: Address;
  depositor?: Address;
  enteredAt: string;
  intendedRange: string;
  notes: string;
  setupTxs: Array<{ label: string; hash: `0x${string}` }>;
  deposited?: {
    lfiRaw: bigint;
    usdcRaw: bigint;
  };
}

export const managedPositions: ManagedPositionRecord[] = [
  {
    tokenId: 346537n,
    label: 'Clawberto CL200 wallet-held band',
    origin: 'hermes-managed',
    pair: 'LFI/USDC',
    pool: CONTRACTS.pool,
    gauge: CONTRACTS.gauge,
    nftManager: CONTRACTS.nftManager,
    depositor: WALLET_ADDRESS,
    enteredAt: '2026-05-10',
    intendedRange: 'One CL200 tick, -364400 to -364200, live wallet-held position',
    notes: 'Live Base RPC shows this as the current positive-liquidity LFI/USDC NFT owned by the Clawberto wallet. It is not gauge-staked, so the dashboard does not assign emissions APR or pending AERO.',
    setupTxs: [
      { label: 'Mint wallet-held NFT #346537', hash: '0x579b90e03c8236d723321e032f81fc004f0d282a7de92f3aad268bd45fd6cb02' },
    ],
  },
];
