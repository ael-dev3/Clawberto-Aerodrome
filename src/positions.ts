import type { Address } from 'viem';
import { CONTRACTS, WALLET_ADDRESS } from './config';

export type PositionOrigin = 'hermes-managed' | 'ael-existing' | 'historical';

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
    tokenId: 341439n,
    label: 'Hermes CL200 50% band',
    origin: 'hermes-managed',
    pair: 'LFI/USDC',
    pool: CONTRACTS.pool,
    gauge: CONTRACTS.gauge,
    nftManager: CONTRACTS.nftManager,
    depositor: WALLET_ADDRESS,
    enteredAt: '2026-05-10',
    intendedRange: '50% each side from entry tick, CL200 aligned',
    notes: 'Minted by Hermes from main wallet and staked into the Aerodrome gauge. This is the canonical live managed position.',
    deposited: {
      lfiRaw: 9731554156611989780999n,
      usdcRaw: 2000000n,
    },
    setupTxs: [
      { label: 'Swap native ETH to USDC', hash: '0xe186753cdb5c370e1f7bff2633db72a20976fd42b5e59120a12cf42024f6b01b' },
      { label: 'Swap native ETH to LFI', hash: '0x4ea8cb2e4ceee375be9e6402a298f0c3d59477a80c31b1512b02859ebde0611a' },
      { label: 'Approve USDC to NFT manager', hash: '0x108f25b13529cabc0b5e799d694cd6f8237874cb76cac8c85bfcd5e1283c5817' },
      { label: 'Approve LFI to NFT manager', hash: '0xb92ae9b1802719deff8eeb429a7f20c6cfba56a82a965fb310b27761854cf773' },
      { label: 'Mint NFT #341439', hash: '0x8adcba0c034c3764c0d785f76872b794d41460142ae8d7744523d61f27c375ac' },
      { label: 'Approve NFT to gauge', hash: '0x12bb417fb03738bcd3bd3976f6c9d6fc55c7c6e337fd71522fc0cb0ba8daa0ce' },
      { label: 'Stake NFT in gauge', hash: '0x68bb02c2c4494f32222e355298c030e90889199eace4aec59577d77abb25d5d0' },
    ],
  },
  {
    tokenId: 341002n,
    label: 'Ael reference position',
    origin: 'ael-existing',
    pair: 'LFI/USDC',
    pool: CONTRACTS.pool,
    gauge: CONTRACTS.gauge,
    nftManager: CONTRACTS.nftManager,
    enteredAt: 'Before Hermes management',
    intendedRange: 'Existing staked range supplied by Ael',
    notes: 'Tracked for dashboard context. Depositor is not configured, so live staking custody is inferred from ownerOf == gauge.',
    setupTxs: [],
  },
];

export const positionHistory = [
  {
    date: '2026-05-10',
    event: 'Entered and staked NFT #341439',
    detail: '50% each-side CL200 range. Mint used 9,731.554156611989780999 LFI and 2 USDC.',
    tokenId: 341439n,
    tx: '0x68bb02c2c4494f32222e355298c030e90889199eace4aec59577d77abb25d5d0' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Tracking existing NFT #341002',
    detail: 'Ael reference position is shown for context. Live owner/range reads come from Base RPC; depositor is unknown unless later recovered.',
    tokenId: 341002n,
  },
  {
    date: '2026-05-10',
    event: 'No exited Hermes positions recorded yet',
    detail: 'When a managed LP is exited, this timeline and the active registry above must be updated so the site shows the no-position or historical state.',
  },
];
