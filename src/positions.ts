import type { Address } from 'viem';

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

export const managedPositions: ManagedPositionRecord[] = [];

export const positionHistory = [
  {
    date: '2026-05-10',
    event: 'On-chain audit: no active tracked LP',
    detail: 'Base RPC and current gauge NFT checks found no active LFI/USDC Slipstream NFT for either tracked wallet. Wallet ERC-20 balances still render live at the top of the dashboard.',
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345359',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345359n,
    tx: '0xe30504e1f91f16bd72bad7ecf14a0c0948e252789ea167139075f4b458571581' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345395',
    detail: 'Range -364600 to -364400 around tick -364502. Mint used 0 LFI and 0.000001 USDC.',
    tokenId: 345395n,
    tx: '0x1c7051ba43fcbbc0a262e8c655923d0db28f9b6fa683a2c5049327594098531b' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345324',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345324n,
    tx: '0x5e1e2c93bcae7d1a90a293772090d970d4cf7b6e9506ee23576641dd9df1f213' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345359',
    detail: 'Range -364600 to -364400 around tick -364561. Mint used 6,391.314163 LFI and 0.234326 USDC.',
    tokenId: 345359n,
    tx: '0x3ab4bf85172311634d5159979fc124532c6b24c4689f958b081ceac63697f18d' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345270',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345270n,
    tx: '0x557e0e3646d827943725aaba4fb4c2c8a1503a3c8a9434637918e07882fc3e39' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345324',
    detail: 'Range -364800 to -364600 around tick -364770. Mint used 46,525.509645 LFI and 1.203946 USDC.',
    tokenId: 345324n,
    tx: '0xc5dab20d14de44e2278ed5f7b5e8d8b17a0d6b8139b02588ee81ae35bb9b8424' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345209',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345209n,
    tx: '0x0a18528f57a50aa532ad43406d816486e96caa0a2d5c6be86e30f93f232d54a2' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345270',
    detail: 'Range -365000 to -364800 around tick -364981. Mint used 58,866.621685 LFI and 0.923482 USDC.',
    tokenId: 345270n,
    tx: '0x67c0164b288837c8650df26eb31132af5ae8c1f15f8038eeacee59122f57be2b' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345181',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345181n,
    tx: '0xe7214abc3f7d4e511562c5ec352b56cccb064ccfaccd8e98ae3700bd48246eec' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345209',
    detail: 'Range -365200 to -365000 around tick -365012. Mint used 4,066.765851 LFI and 9.125564 USDC.',
    tokenId: 345209n,
    tx: '0xa734bc5758b319a31bbf72341d9aac4d6887d52ce30064e8ed180fb262ea7229' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345104',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345104n,
    tx: '0x6b08c268fbd1dfd5ad7fc68dbb04e7a74ad47c32397611d51fceee8415d1eb88' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345181',
    detail: 'Range -365400 to -365200 around tick -365206. Mint used 2,067.749481 LFI and 9.426593 USDC.',
    tokenId: 345181n,
    tx: '0xf6c1246aec6266a9f0b010d31bc903a60d80d5b748c846f446b991ee5dfdaae2' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345063',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345063n,
    tx: '0x6db27f3f74d22c73f8b7f2575216d29e38be82f733cfdb8d5e82787fc43c3dbb' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345104',
    detail: 'Range -365200 to -365000 around tick -365011. Mint used 4,754.0302 LFI and 11.597335 USDC.',
    tokenId: 345104n,
    tx: '0x01a30b441fc5074b31b0bb1e0e398b7f104b7b9a8a3d5086fa5515d272b38d7f' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Exited previous Hermes NFT #345027',
    detail: 'One-cron rebalance closed the previous managed range before entering the 2% one-tick band.',
    tokenId: 345027n,
    tx: '0xa865c1e200adc2cc689b32b3e084d8e8fa027e94ff55ba5d2d8e90c9709bbb6b' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Entered and staked one-tick NFT #345063',
    detail: 'Range -365200 to -365000 around tick -365047. Mint used 17,991.479636 LFI and 7.094843 USDC.',
    tokenId: 345063n,
    tx: '0xcaf09bb3529e340e030ba85604440385b20ec966947b6b878a8501abb260e3bc' as `0x${string}`,
  },
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
    event: 'Exited and burned NFT #341439',
    detail: 'Base logs show NFT #341439 moved from gauge back to Clawberto, then to the zero address. It is no longer an active LP and is intentionally not in the active registry.',
    tokenId: 341439n,
    tx: '0x9dfdb8e5ac2aefd837f07ffe46a0ad95482898c185b7b8007021f3cb1a94911b' as `0x${string}`,
  },
  {
    date: '2026-05-10',
    event: 'Rejected stale Ael NFT #341002',
    detail: 'Live RPC resolves #341002 under the alternate position manager as WETH/USDC with zero liquidity and no stake for either tracked wallet, so it is excluded from LFI/USDC scoring.',
    tokenId: 341002n,
  },
];
