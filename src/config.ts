import type { Address } from 'viem';

export const BASE_CHAIN_ID = 8453;
export const WALLET_ADDRESS = '0xC979efda857823bcA9A335a6c7b62A7531e1cFEA' as Address;
export const COMPARISON_WALLET_ADDRESS = '0x8db2Ef0C439ca22f736A66988a5491a6219F679e' as Address;
export const HUMAN_LP_CONTROLLER_ADDRESS = '0xB1DC9E197662B50eE3cabAE44aDa9898e9906dD3' as Address;

export const CONTRACTS = {
  pool: '0x8343c68279587498526114e6385f0a87f248e0d9',
  lfiReferencePool: '0x6ef02666f150d9649655b884e043b61b0990fad9be4c632d0c7568bb24da9367',
  gauge: '0xE9C73937382C621770f5b7018A407C0749df6aaE',
  nftManager: '0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53',
  lfi: '0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  aero: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
} as const satisfies Record<string, Address>;

export const TOKEN_META = {
  [CONTRACTS.lfi]: { symbol: 'LFI', decimals: 18, accent: '#a78bfa' },
  [CONTRACTS.usdc]: { symbol: 'USDC', decimals: 6, accent: '#2775ca' },
  [CONTRACTS.aero]: { symbol: 'AERO', decimals: 18, accent: '#7132f5' },
} as const;

export const RPC_ENDPOINTS = [
  'https://base-rpc.publicnode.com',
  'https://1rpc.io/base',
  'https://base.drpc.org',
  'https://base-mainnet.public.blastapi.io',
  'https://mainnet.base.org',
] as const;

export const TRACKED_WALLETS = [
  { label: 'Clawberto agent', shortLabel: 'AI agent', address: WALLET_ADDRESS, role: 'agent' },
  {
    label: 'Ael manual wallet',
    shortLabel: 'Manual human',
    address: COMPARISON_WALLET_ADDRESS,
    role: 'human',
    positionAddresses: [HUMAN_LP_CONTROLLER_ADDRESS],
  },
] as const;
