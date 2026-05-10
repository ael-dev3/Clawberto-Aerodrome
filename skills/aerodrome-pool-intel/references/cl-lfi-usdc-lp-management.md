# Aerodrome CL200 LFI/USDC LP Management Playbook

Live pool requested by Ael:

- Chain: Base mainnet (`8453`)
- Pair: `CL200-LFI/USDC`
- Pool: `0x8343c68279587498526114e6385f0a87f248e0d9`
- Gauge: `0xe9c73937382c621770f5b7018a407c0749df6aae`
- Position NFT manager: `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`
- Current Hermes-managed NFT: `341439`
- Reference/tracked existing NFT: `341002`
- Live dashboard: `https://ael-dev3.github.io/Clawberto-Aerodrome/`
- Dashboard source of truth: `src/positions.ts`

This is a Slipstream/CL min-unstake deployment, not a classic volatile/stable Aerodrome pair. Do not use `getPool(token0, token1, bool stable)` for this pool. Use CL tick spacing (`int24`) paths.

## Deployment contracts for this pool family

From Aerodrome Slipstream `DeployCL-Base-MinUnstake.json`:

- CL `PoolFactory`: `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`
- CL `GaugeFactory`: `0x385293CaE378C813F16f0C1334d774AdDDf56AbB`
- `NonfungiblePositionManager`: `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`
- `SwapRouter`: `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F`
- `Quoter`: `0x514c8B5f54112481E28028F1166Bd78501089259`
- `MixedQuoterV2`: `0xb4A9E5Fc0727BEF09D819fcfc5ece8CA9bCf09EB`
- `MixedQuoterV3`: `0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555`
- `Redistributor`: `0xEe5b3C7b333e2870B746b3B2b168EF0958e55e15`

Core Aerodrome Voter remains:

- `Voter`: `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`
- `AERO`: `0x940181a94A35A4569E4529A3CDfB74e38FD98631`

## Live pool facts read from chain

Pool `0x8343c68279587498526114e6385f0a87f248e0d9`:

- `token0()(address)` -> `0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3` (`LFI`, 18 decimals)
- `token1()(address)` -> `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (`USDC`, 6 decimals)
- `tickSpacing()(int24)` -> `200`
- `fee()(uint24)` -> `10000` (1% swap fee; denominator is 1e6)
- `unstakedFee()(uint24)` -> `100000`
- `factory()(address)` -> `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`
- `gauge()(address)` -> `0xe9c73937382c621770f5b7018a407c0749df6aae`
- `nft()(address)` -> `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`
- `slot0()(uint160,int24,uint16,uint16,uint16,bool)` -> current sqrt/tick shape. Do **not** decode with the Uniswap V3 7-return `feeProtocol` shape.
- Observed tick during contract read: `-365608`
- `stakedLiquidity()(uint128)` observed: `16800805114889090603`
- `liquidity()(uint128)` observed: `23153837321316885811`

Gauge `0xe9c73937382c621770f5b7018a407c0749df6aae`:

- `pool()(address)` -> `0x8343c68279587498526114e6385f0a87f248e0d9`
- `nft()(address)` -> `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`
- `voter()(address)` -> `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`
- `gaugeFactory()(address)` -> `0x385293CaE378C813F16f0C1334d774AdDDf56AbB`
- `minter()(address)` -> `0xeB018363F0a9Af8f91F06FEe6613a751b2A33FE5`
- `rewardToken()(address)` -> `0x940181a94A35A4569E4529A3CDfB74e38FD98631` (`AERO`)
- `feesVotingReward()(address)` -> `0xd7eBa84B7d965480B82c73eE6a746B758c7CE3C1`
- Voter `gaugeToBribe(gauge)` -> `0x885aB0075108d51Ac21483c182b0fb84f36A8A03`
- `isPool()(bool)` -> `true`
- `rewardRate()(uint256)` and `left()(uint256)` are the AERO emission source for staking APR.

NFT `341002` on `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`:

- `ownerOf(341002)` -> `0xe9c73937382c621770f5b7018a407c0749df6aae` at read time, meaning the NFT is staked in the gauge.
- `positions(341002)` -> token0 LFI, token1 USDC, tickSpacing `200`, tickLower `-367400`, tickUpper `-365200`, liquidity `8743302714174061`, tokensOwed0 `0`, tokensOwed1 `0` at read time.

NFT `341439` on `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`:

- Mint tx: `0x8adcba0c034c3764c0d785f76872b794d41460142ae8d7744523d61f27c375ac`.
- Gauge stake tx: `0x68bb02c2c4494f32222e355298c030e90889199eace4aec59577d77abb25d5d0`.
- Range: tickLower `-373000`, tickUpper `-361800`; staked when `ownerOf(341439) == gauge`.
- Initial mint amounts: `9731.554156611989780999` LFI and `2.000000` USDC.

## Dashboard update requirement

Every managed LP enter, exit, rebalance, claim, or no-position transition must update the public dashboard before reporting completion:

1. Update `src/positions.ts` with the new active position set and history entry.
2. Run `npm test && npm run build`.
3. Commit and push to `main`; GitHub Actions deploys Pages from `dist`.
4. Verify `https://ael-dev3.github.io/Clawberto-Aerodrome/` loads and renders live Base RPC data without console errors.

## Critical staking model

Aerodrome CL staking differs from Kittenswap Algebra staking:

- When staked, the NFT is transferred to the gauge, so `NonfungiblePositionManager.ownerOf(tokenId) == gauge`.
- The original depositor is tracked inside gauge `_stakes[depositor]` and is not directly exposed as `tokenId => depositor`.
- `earned(address account, uint256 tokenId)`, `getReward(uint256)`, and `withdraw(uint256)` require the original depositor/sender. Calling them with the gauge address or an unknown account reverts with `NA`.
- Correct staked status for a known depositor is:
  1. `ownerOf(tokenId) == gauge`, and
  2. `gauge.stakedContains(depositor, tokenId) == true`.
- If the depositor is unknown, recover it from historical `Deposit(address indexed user, uint256 indexed tokenId, uint128 indexed liquidityToStake)` logs before planning a state-changing action.

Never treat `ownerOf(tokenId) == gauge` as the human owner. It only proves custody is in the gauge.

## Read-only status calls

Use these before any LP action:

```bash
RPC=https://base-rpc.publicnode.com
POOL=0x8343c68279587498526114e6385f0a87f248e0d9
GAUGE=0xe9c73937382c621770f5b7018a407c0749df6aae
NFT=0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53
TOKEN_ID=341002

cast call --rpc-url "$RPC" "$POOL" 'slot0()(uint160,int24,uint16,uint16,uint16,bool)'
cast call --rpc-url "$RPC" "$NFT" 'ownerOf(uint256)(address)' "$TOKEN_ID"
cast call --rpc-url "$RPC" "$NFT" 'positions(uint256)(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)' "$TOKEN_ID"
cast call --rpc-url "$RPC" "$GAUGE" 'rewardRate()(uint256)'
cast call --rpc-url "$RPC" "$GAUGE" 'left()(uint256)'
cast call --rpc-url "$RPC" "$GAUGE" 'depositTimestamp(uint256)(uint256)' "$TOKEN_ID"
# Requires known original depositor:
cast call --rpc-url "$RPC" "$GAUGE" 'stakedContains(address,uint256)(bool)' "$DEPOSITOR" "$TOKEN_ID"
cast call --rpc-url "$RPC" "$GAUGE" 'earned(address,uint256)(uint256)' "$DEPOSITOR" "$TOKEN_ID"
```

## Management action sequence

### Stake an unstaked NFT

Hard gates:

- `ownerOf(tokenId)` must be the intended depositor.
- `positions(tokenId)` token0/token1/tickSpacing must match gauge token0/token1/tickSpacing.
- `voter.isAlive(gauge)` must be true.
- NFT approval must allow the gauge (`approve(gauge, tokenId)` or `setApprovalForAll(gauge, true)`).

Tx sequence:

1. Approve NFT to gauge if needed.
2. Call gauge `deposit(uint256 tokenId)` from depositor.
3. Verify `ownerOf(tokenId) == gauge` and `stakedContains(depositor, tokenId) == true`.

### Claim AERO reward while keeping position staked

Hard gates:

- Known depositor must satisfy `stakedContains(depositor, tokenId) == true`.
- `earned(depositor, tokenId)` must not revert.

Tx:

- Call gauge `getReward(uint256 tokenId)` from depositor.

### Unstake before managing principal

Hard gates:

- Known depositor must satisfy `stakedContains(depositor, tokenId) == true`.
- `ownerOf(tokenId) == gauge`.

Tx:

- Call gauge `withdraw(uint256 tokenId)` from depositor.

Effects:

- Gauge collects current position fees internally before withdrawal.
- Gauge calls `_getReward`, paying AERO to depositor subject to min-stake penalty.
- Gauge updates pool virtual staked liquidity.
- NFT transfers back to depositor.

Verify before next step:

- `ownerOf(tokenId) == depositor`
- `stakedContains(depositor, tokenId) == false`

### Remove / close old LP principal

Only after unstaking. A depositor cannot directly operate a staked NFT because `ownerOf(tokenId) == gauge`.

Tx sequence on `NonfungiblePositionManager`:

1. `collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max))`
2. `decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline))`
3. `collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max))`
4. Optional close only when liquidity and owed tokens are zero: `burn(uint256 tokenId)`

Hard gates:

- `ownerOf(tokenId) == depositor` or depositor is approved.
- `deadline` is seconds, not milliseconds.
- Do not use stale amount minimums after price movement; regenerate the plan.
- Only burn with explicit close intent.

### Mint replacement CL position

Use the CL position manager tuple, not classic LP flows:

`mint((address token0,address token1,int24 tickSpacing,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline,uint160 sqrtPriceX96))`

Hard gates:

- Token order must be canonical: LFI is token0, USDC is token1 for this pool.
- Tick spacing must be `200`; lower/upper ticks must be multiples of `200`.
- Use `sqrtPriceX96 = 0` for existing initialized pool mints.
- ERC20 approvals must target `NonfungiblePositionManager`, not the router.
- Direct `eth_call` simulation and gas estimate must pass before signing.

Post-mint default for managed strategy:

1. Approve NFT to gauge if required.
2. Call gauge `deposit(newTokenId)`.
3. Verify staked status.

### Swap/rebalance inventory

Use CL router, not the classic Aerodrome router:

- Router: `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F`
- Quoter: `0x514c8B5f54112481E28028F1166Bd78501089259`
- Single-hop swap function: `exactInputSingle((address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96))`
- Quoter function: `quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96))`

Use `tickSpacing=200` for LFI/USDC. Route through another token only if direct quote/liquidity is insufficient and the route has been quoted explicitly.

## Required Aerodrome command surface to port from Kittenswap

The Kittenswap repo pattern to copy is not the contract addresses, it is the control-plane shape:

- `contracts`: print CL min-unstake deployment addresses.
- `pool-resolve`: resolve pair by `(token0, token1, tickSpacing)` and verify gauge via Voter.
- `position <tokenId>`: read NFT position, current pool tick, range headroom, owner/staked state.
- `stake-status <tokenId> <depositor>`: use `ownerOf`, `stakedContains`, `earned`, `depositTimestamp`.
- `stake-plan <tokenId> <depositor>`: print NFT approval requirement and gauge `deposit` calldata.
- `unstake-plan <tokenId> <depositor>`: print gauge `withdraw` calldata and hard blockers.
- `claim-plan <tokenId> <depositor>`: print gauge `getReward` calldata and reward estimate.
- `withdraw-plan <tokenId> <depositor>`: after unstake, print `collect -> decreaseLiquidity -> collect -> optional burn`.
- `mint-plan`: normalize token order, align ticks, compute amount mins, simulate NPM `mint`, and print exact calldata.
- `swap-quote` / `swap-plan`: use CL quoter/router tuple signatures and print allowance/slippage gates.
- `heartbeat`: output `HOLD | UNSTAKE_REQUIRED | REBALANCE_COMPOUND_RESTAKE | STAKE_REMEDIATION_REQUIRED`, both side headroom, reward velocity, and explicit blockers.
- `tx-verify`: decode selectors for gauge deposit/withdraw/getReward, NPM mint/decrease/collect/burn, router exactInputSingle, and confirm post-state after each tx.

Until those commands exist, do not claim execution support. Use this reference to perform read-only checks and to build deterministic calldata plans only.

## May 10, 2026 one-cron remediation findings

Observed failure mode from the aggressive 30s one-tick run:

- The dashboard tracked burned NFT `#345395` while several failed one-cron leftovers were still wallet-owned and unstaked.
- Wallet-owned out-of-range leftovers found and closed: `#345349`, `#345384`, `#345412`; additional orphan discovered from one-cron logs/state and closed: `#345174`.
- New active position after remediation: NFT `#345949`, range `-365000 → -364800`, staked in gauge and verified with `ownerOf(345949) == gauge` plus `stakedContains(wallet, 345949) == true`.

Workflow rules added from this incident:

1. Do not trust only `src/positions.ts` for cleanup. Build a candidate set from `src/positions.ts`, `runs/aerodrome-one-cron/state.json`, launchd logs, and `HERMES_EXTRA_TOKEN_IDS`.
2. Failed mints must be persisted before approve/deposit. If stake fails or the tick moves out before deposit, close the fresh wallet-owned NFT immediately or persist it for next-cycle cleanup.
3. Re-read `slot0` immediately before gauge `deposit`. One-tick CL200 ranges can move out of range between mint and stake.
4. For wallet-owned out-of-range leftovers with `tokensOwed0 == tokensOwed1 == 0`, the successful close path was `decreaseLiquidity -> collect -> burn`; collect-first is still valid when owed fees are already nonzero, but a collect-only tx can waste gas if there is nothing currently owed.
5. Use a churn brake: keep the scheduler at 30s if requested, but set `HERMES_REBALANCE_COOLDOWN_SECONDS` so range drift does not continuously burn gas. Stake remediation and orphan cleanup bypass the churn cooldown.
6. Reject dust mints with `HERMES_MIN_POSITION_USD`; otherwise a drained wallet can mint microscopic positions that cannot justify gas.
7. A verified on-chain LP change is not complete until `src/positions.ts` is updated, tests/build pass, the commit is pushed, Pages deploys, and the live dashboard renders the new state.

## Hard failure rules

- Do not operate from truncated addresses.
- Do not use classic Aerodrome pool/gauge logic for this CL pool.
- Do not use `slot0` 7-return decode.
- Do not use `getPool(address,address,bool)` for this CL factory.
- Do not manage principal while NFT is staked; unstake first.
- Do not call depositor-gated gauge functions without known original depositor.
- Do not send dependent transactions in parallel. Verify each tx before the next one.
- Do not retry stale mint/swap/decrease calldata after a revert; regenerate from fresh slot0/tick/balances/allowances.
