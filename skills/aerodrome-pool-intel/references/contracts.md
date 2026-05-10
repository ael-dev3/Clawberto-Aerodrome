# Aerodrome Contract Map (Base Mainnet)

## Core registry and protocol

| Contract | Address |
| --- | --- |
| Voter | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` |
| VotingEscrow | `0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4` |
| FactoryRegistry | `0x5C3F18F06CC09CA1910767A34a20F771039E37C0` |
| PoolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` |
| GaugeFactory | `0x35f35cA5B132CaDf2916BaB57639128eAC5bbcb5` |
| Minter | `0xeB018363F0a9Af8f91F06FEe6613a751b2A33FE5` |
| Router | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` |
| RewardsDistributor | `0x227f65131A261548b057215bB1D5Ab2997964C7d` |
| ArtProxy | `0xE9992487b2EE03b7a91241695A58E0ef3654643E` |

## Slipstream CL min-unstake deployment

Use this deployment for `CL200-LFI/USDC` and similar managed CL NFT positions.

| Contract | Address |
| --- | --- |
| CL PoolFactory | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` |
| CL GaugeFactory | `0x385293CaE378C813F16f0C1334d774AdDDf56AbB` |
| CL NonfungiblePositionManager | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` |
| CL SwapRouter | `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F` |
| CL Quoter | `0x514c8B5f54112481E28028F1166Bd78501089259` |
| CL MixedQuoterV2 | `0xb4A9E5Fc0727BEF09D819fcfc5ece8CA9bCf09EB` |
| CL MixedQuoterV3 | `0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555` |

### Managed CL200-LFI/USDC contracts

| Contract | Address |
| --- | --- |
| LFI token0 | `0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3` |
| USDC token1 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| CL200-LFI/USDC pool | `0x8343c68279587498526114e6385f0a87f248e0d9` |
| CL200-LFI/USDC gauge | `0xe9c73937382c621770f5b7018a407c0749df6aae` |
| FeesVotingReward | `0xd7eBa84B7d965480B82c73eE6a746B758c7CE3C1` |
| BribeVotingReward | `0x885aB0075108d51Ac21483c182b0fb84f36A8A03` |

CL ABI notes:

- Resolve pools with `getPool(address,address,int24)(address)`, not `getPool(address,address,bool)`.
- Decode CL `slot0` as `slot0()(uint160,int24,uint16,uint16,uint16,bool)`.
- Decode CL NFT positions as `positions(uint256)(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)`.
- Gauge custody means `ownerOf(tokenId) == gauge`; the actionable depositor must be checked through `stakedContains(depositor, tokenId)` or recovered from deposit logs.

## Tokens

- `AERO` `0x940181a94A35A4569E4529A3CDfB74e38FD98631`
- `WETH` `0x4200000000000000000000000000000000000006`
- `USDC` `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## On-chain discovery model used by this repo

1. Read `FactoryRegistry.poolFactoriesLength()` and enumerate all `poolFactories(i)`.
2. For each pool factory, read `allPoolsLength()` and enumerate `allPools(i)`.
3. For each pool:
   - `metadata()` (or fallback `token0`, `token1`, `stable`, `getReserves()`).
   - `voter.gauges(pool)`
   - `voter.weights(pool)`
   - if gauge exists, read `isAlive(gauge)` and core gauge metrics.
   - map bribe/fees reward contracts through `voter.gaugeToBribe(gauge)` and `voter.gaugeToFees(gauge)`.
4. Resolve market data in a separate pass from DexScreener (24h volume/liquidity, optional safety).

## Discovery command

```bash
python3 skills/aerodrome-pool-intel/scripts/discover_aerodrome_contracts.py \
  --max-pools 4000 \
  --write-json metadata/live_contracts_base_mainnet.json \
  --write-csv metadata/live_contracts_base_mainnet.csv
```

> Full network scan is intentionally expensive and can be run separately from ranking scans.
