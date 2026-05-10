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
    tokenId: 344918n,
    label: 'Hermes CL200 one-tick band',
    origin: 'hermes-managed',
    pair: 'LFI/USDC',
    pool: CONTRACTS.pool,
    gauge: CONTRACTS.gauge,
    nftManager: CONTRACTS.nftManager,
    depositor: WALLET_ADDRESS,
    enteredAt: '2026-05-10',
    intendedRange: 'One CL200 tick, -366000 to -365800, rebalanced from tick -365958',
    notes: 'Rebalanced by the Hermes one-cron Aerodrome executor into the active one-tick band and staked into the Aerodrome gauge.',
    deposited: {
      lfiRaw: 67407341139718630443911n,
      usdcRaw: 2339600n,
    },
    setupTxs: [
      { label: 'Withdraw old NFT #344895', hash: '0x9c8fc18f79e13afa7a8604e60f4881b39370de79b74e7448a42a114568551c53' },
      { label: 'Collect old NFT #344895', hash: '0x67adfddb0902e22cde13bc12a6d5e40ea1448109c8e600493d48a881835b195b' },
      { label: 'Decrease old NFT #344895', hash: '0x977da6d5aa26e9434f5fffbcf259e243f6babd7a0b26a52752da6709699901c3' },
      { label: 'Final collect old NFT #344895', hash: '0xec035478ec3a4bef13bc644c7ee2a37d3a36145c376ceca8e7a37de9ed64a29f' },
      { label: 'Burn old NFT #344895', hash: '0x4a719974aa05bd76d60df87de9e2d713c396a94c95c1d07c8ce39c55ac283be6' },
      { label: 'Balance USDC to LFI', hash: '0x14eeda1e0c2c379a3ff794e76447b73e11f4fece2a1699e761a39ffe10ca8c3f' },
      { label: 'Mint one-tick NFT #344918', hash: '0x12a322f1f0f22263dd01c7114837f0d0b7f090507802e31b7fd6bd4808f9749a' },
      { label: 'Approve NFT #344918 to gauge', hash: '0x3ec7bab18cba9bd6eb03f0b8ed2e51edc3cbe8bda660f4f6b554c7d9bb0b27e9' },
      { label: 'Stake NFT #344918', hash: '0xce326dbc1e2dcfed98223b7fb0906f95eb648fa2c1d9ebf3e8c67369ea36fc79' },
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
    event: 'Exited previous Hermes NFT #344895',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 344895n,
    tx: '0x4a719974aa05bd76d60df87de9e2d713c396a94c95c1d07c8ce39c55ac283be6' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #344918',
    detail: 'Range -366000 to -365800 around tick -365958. Mint used 67,407.34114 LFI and 2.3396 USDC.',
    tokenId: 344918n,
    tx: '0xce326dbc1e2dcfed98223b7fb0906f95eb648fa2c1d9ebf3e8c67369ea36fc79' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #344861',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 344861n,
    tx: '0x2ab55a221b911b64714f39e12da5eff590c545a2e9cd084a893040c333e95025' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #344895',
    detail: 'Range -366200 to -366000 around tick -366027. Mint used 0 LFI and 9.903677 USDC.',
    tokenId: 344895n,
    tx: '0x851f9d4aff9ca6bba77b52235ba94d043d3c1d18b357df47169747d21e9b719c' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #344803',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 344803n,
    tx: '0xb40d5720949584c0e35925908aa61c58f28c0dbaaed20850c55195b27f8ea8c6' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #344861',
    detail: 'Range -366000 to -365800 around tick -365990. Mint used 47,495.465474 LFI and 0.383568 USDC.',
    tokenId: 344861n,
    tx: '0xa6d31b6f884d96d8a302a3bdd8bd1057a0b56ab5f1f61566f596748c090f2c97' as `0x${string}`,
  },
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
