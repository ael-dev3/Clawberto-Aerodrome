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
    tokenId: 344966n,
    label: 'Hermes CL200 one-tick band',
    origin: 'hermes-managed',
    pair: 'LFI/USDC',
    pool: CONTRACTS.pool,
    gauge: CONTRACTS.gauge,
    nftManager: CONTRACTS.nftManager,
    depositor: WALLET_ADDRESS,
    enteredAt: '2026-05-10',
    intendedRange: 'One CL200 tick, -365600 to -365400, rebalanced from tick -365531',
    notes: 'Rebalanced by the Hermes one-cron Aerodrome executor into the active one-tick band and staked into the Aerodrome gauge.',
    deposited: {
      lfiRaw: -45540893242153259943601n,
      usdcRaw: 524762n,
    },
    setupTxs: [
      { label: 'Withdraw old NFT #344918', hash: '0x9ed5a0b5e2b1e5365cfea66f230727b036bb6e6a0b54ae616c6e8cbfb6409b92' },
      { label: 'Collect old NFT #344918', hash: '0xb2d95eee1817656c0655e83812c3f6470c68963880fdc8fa03406be558f307da' },
      { label: 'Decrease old NFT #344918', hash: '0x143ee466c79e6d4139f4e12ad515a1ccceb633a47b4f7f732199ed46ba97222b' },
      { label: 'Final collect old NFT #344918', hash: '0xca3b374386b188ff992de3b2f81fc9c3f994180150951d2e6cfa89042b58ca06' },
      { label: 'Burn old NFT #344918', hash: '0x9cf88c6933f8a86ed2f213675066ac544cd47294cd6e07e68620ebb530f9e99f' },
      { label: 'Balance USDC to LFI', hash: '0x8e7888d77e317a76989998d939161eaf2c3a7b66c82d98117a73c9b3637b0b66' },
      { label: 'Mint one-tick NFT #344966', hash: '0x6b9f756c02b7a5e53ffd8703ad9323c667374912c3a42e76945ec22bf625fca2' },
      { label: 'Approve NFT #344966 to gauge', hash: '0xee1294384c0b66932f2230593563420dbe54b48ed649f14f31a914796d0d9e5e' },
      { label: 'Stake NFT #344966', hash: '0x4506310d5fe17e81b8ceb9ff4e41015601eaff6690a1f4af7a6b614edbd05e51' },
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
    event: 'Exited previous Hermes NFT #344918',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 344918n,
    tx: '0x9cf88c6933f8a86ed2f213675066ac544cd47294cd6e07e68620ebb530f9e99f' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #344966',
    detail: 'Range -365600 to -365400 around tick -365531. Mint used -45,540.893242 LFI and 0.524762 USDC.',
    tokenId: 344966n,
    tx: '0x4506310d5fe17e81b8ceb9ff4e41015601eaff6690a1f4af7a6b614edbd05e51' as `0x${string}`,
  },
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
