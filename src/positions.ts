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
    tokenId: 345027n,
    label: 'Hermes CL200 one-tick band',
    origin: 'hermes-managed',
    pair: 'LFI/USDC',
    pool: CONTRACTS.pool,
    gauge: CONTRACTS.gauge,
    nftManager: CONTRACTS.nftManager,
    depositor: WALLET_ADDRESS,
    enteredAt: '2026-05-10',
    intendedRange: 'One CL200 tick, -365200 to -365000, rebalanced from tick -365078',
    notes: 'Rebalanced by the Hermes one-cron Aerodrome executor into the active one-tick band and staked into the Aerodrome gauge.',
    deposited: {
      lfiRaw: 23063171770761925091720n,
      usdcRaw: 7521162n,
    },
    setupTxs: [
      { label: 'Withdraw old NFT #344966', hash: '0xe08999d8e3ab2b1a85dc10adbfd20834170e8a23fb74002c419eaabfd4a8a68c' },
      { label: 'Collect old NFT #344966', hash: '0x2dc00a48ff0fbb9181ef4e3c78ad812edbe96d9f00d729b2bbdebe42f059d322' },
      { label: 'Decrease old NFT #344966', hash: '0x3a77a12128af33ac493b59b20fa68bf4a3aae69ae17d65cd8d75bcde8efaac15' },
      { label: 'Final collect old NFT #344966', hash: '0xb2d1418899ff9283ca4f9c1245154992515451ecfb64b84860ea4ba495ada686' },
      { label: 'Burn old NFT #344966', hash: '0xc6341b41fd871358759802983e8dad6bfe8e8436f85309346c9f5b4c40c1728f' },
      { label: 'Balance LFI to USDC', hash: '0x57512d73d26a470ba56c8701ec340a05f2467483fa95b4dc4019d8b4775084c3' },
      { label: 'Mint one-tick NFT #345027', hash: '0xac742740ede14d35c3c08d239049c07c594a9e204c98189b28d5413564d275b9' },
      { label: 'Approve NFT #345027 to gauge', hash: '0xc25deb6fc009e764857e98e9e57070862b98a8d1a76b0b23e4813f8563b2bc02' },
      { label: 'Stake NFT #345027', hash: '0x7246d6cd999903a7f0ebc1c99453140aaf4bc3ef1bd9a84923cae93b3dde7cee' },
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
    event: 'Exited previous Hermes NFT #344966',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 344966n,
    tx: '0xc6341b41fd871358759802983e8dad6bfe8e8436f85309346c9f5b4c40c1728f' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345027',
    detail: 'Range -365200 to -365000 around tick -365078. Mint used 23,063.171771 LFI and 7.521162 USDC.',
    tokenId: 345027n,
    tx: '0x7246d6cd999903a7f0ebc1c99453140aaf4bc3ef1bd9a84923cae93b3dde7cee' as `0x${string}`,
  },
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
