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
