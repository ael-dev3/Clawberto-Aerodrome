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
    tokenId: 344803n,
    label: 'Hermes CL200 one-tick band',
    origin: 'hermes-managed',
    pair: 'LFI/USDC',
    pool: CONTRACTS.pool,
    gauge: CONTRACTS.gauge,
    nftManager: CONTRACTS.nftManager,
    depositor: WALLET_ADDRESS,
    enteredAt: '2026-05-10',
    intendedRange: 'One CL200 tick, -366200 to -366000, rebalanced from tick -366043',
    notes: 'Rebalanced by the Hermes one-cron Aerodrome executor into the active one-tick band and staked into the Aerodrome gauge.',
    deposited: {
      lfiRaw: 6507292821670624064690n,
      usdcRaw: 3577095n,
    },
    setupTxs: [
      { label: 'Collect old NFT #341439', hash: '0x2113a1a4054d9febf2aa2378d1c200277b7ffcdc64cae37e583a2b06ccc39b58' },
      { label: 'Burn old NFT #341439', hash: '0x9dfdb8e5ac2aefd837f07ffe46a0ad95482898c185b7b8007021f3cb1a94911b' },
      { label: 'Swap ETH to USDC via WETH/USDC-1', hash: '0xf7b8d4d37fde094dc5025bfa53a13c7ba4c12e040e91d3759487b6f047fff5d4' },
      { label: 'Approve router LFI', hash: '0x4a3e767e2e0e3f7fea028b27de27ebed51b5ac0085ac1a2291556ceed4dcb63c' },
      { label: 'Balance LFI to USDC', hash: '0x2fdf15ebe661eb3ec82eaddb93e120baa69b8917a1603178eb4c9fb5120fcd52' },
      { label: 'Approve NPM LFI', hash: '0x37bc34602253b6af06d31dbd1868b4c62cb4ee9e8f9753f8f0ea1d26a536f653' },
      { label: 'Approve NPM USDC', hash: '0xbe6d8676b805a4bba7c29e56e885cc6bf32263fad86be6bceac9a4ac1eb2a721' },
      { label: 'Mint one-tick NFT sim#344802', hash: '0xbc7e601985a3b3b85d8d990f75e76b8e3d2978b7c8ad4cc3cf02fd3c92f4a1a4' },
      { label: 'Approve NFT #344803 to gauge', hash: '0xa3bdd2ef6a63a5e6e654a9091c4ebc3a6acea4c6cb760a2c36034963bb18c0f4' },
      { label: 'Stake NFT #344803', hash: '0x0219b121aeb632269a9510bb4b4e11311ccb026894769b2bd06540924bd1bdf6' },
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
    event: 'Exited previous Hermes NFT #341439',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 341439n,
    tx: '0x9dfdb8e5ac2aefd837f07ffe46a0ad95482898c185b7b8007021f3cb1a94911b' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #344803',
    detail: 'Range -366200 to -366000 around tick -366043. Mint used 6,507.292822 LFI and 3.577095 USDC.',
    tokenId: 344803n,
    tx: '0x0219b121aeb632269a9510bb4b4e11311ccb026894769b2bd06540924bd1bdf6' as `0x${string}`,
  },
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
