# Hermes Operational Policy

Hermes may automate monitoring and plan generation from cron. It must not silently broadcast transactions.

## Autonomy Levels

- `observe`: read chain state and write status artifacts only.
- `propose`: read chain state, classify the position, and write transaction-intent plans. This is the default.
- `execute`: reserved for a future signer adapter. Current scripts must mark execution as blocked unless an adapter is implemented and every gate is `PASS`.

## Required Gates Before State Changes

- `depositor_known`: original depositor address is present and valid.
- `position_identity`: NFT token0, token1, and tick spacing match the configured pool.
- `custody_valid`: if staked, `ownerOf(tokenId) == gauge` and `stakedContains(depositor, tokenId) == true`.
- `fresh_slot0`: current tick was read in the same heartbeat as the plan.
- `range_plan_fresh`: replacement lower/upper ticks are aligned to `tick_spacing`.
- `simulation_passed`: the exact calldata was simulated against the configured RPC immediately before signing.
- `post_state_verified`: each transaction is verified before the next dependent transaction is planned.

## Decision Meanings

- `HOLD`: position is staked or intentionally unstaked, in range, and no configured reward threshold is met.
- `CLAIM_REWARD_RECOMMENDED`: AERO earned is at or above the configured threshold and claim gates are satisfied.
- `STAKE_REMEDIATION_REQUIRED`: NFT is held by the depositor instead of the gauge and should be staked after approval checks.
- `UNSTAKE_REBALANCE_RESTAKE_REQUIRED`: position is out of range or too close to a configured edge.
- `MANUAL_REVIEW`: required reads failed, depositor-gated state is missing for a state-changing plan, or identity gates do not match.

## Transaction Intent Policy

Transaction-intent plans are instructions, not proof of execution. They may include target contracts, function signatures, sender requirements, and blocking conditions. They must not claim a tx happened without a verified hash and post-state check.

## Live one-cron executor exception

The repository also contains `scripts/aerodrome-one-cron-rebalance.mjs`, a user-approved signer-backed executor for the managed CL200-LFI/USDC wallet. When `HERMES_LP_EXECUTE=1` is set by the launchd wrapper, it is allowed to broadcast only after the same gates above pass. It must additionally:

- discover managed token ids from `src/positions.ts`, `runs/aerodrome-one-cron/state.json`, launchd logs, and `HERMES_EXTRA_TOKEN_IDS`, not just the dashboard's current token id
- close wallet-owned or gauge-owned out-of-range leftovers before minting a replacement
- persist a freshly minted token id before trying to approve/stake it, so a failed stake cannot become an invisible orphan
- re-read `slot0` immediately before gauge deposit; if the fresh one-tick NFT moved out of range, close it instead of leaving it unstaked
- apply `HERMES_REBALANCE_COOLDOWN_SECONDS` to range-churn rebalances while still allowing stake-remediation and orphan-cleanup actions
- reject dust mints below `HERMES_MIN_POSITION_USD`
- update `src/positions.ts`, run tests/build, commit, push, and verify Pages after every executed LP state change

For principal rebalances, use this order:

1. `gauge.withdraw(uint256 tokenId)` from the depositor.
2. Verify `ownerOf(tokenId) == depositor`.
3. `NonfungiblePositionManager.collect(...)`.
4. `NonfungiblePositionManager.decreaseLiquidity(...)`.
5. `NonfungiblePositionManager.collect(...)`.
6. Mint the replacement CL NFT with aligned ticks and fresh amount minimums.
7. Approve and deposit the new NFT into the gauge.
8. Verify gauge custody and depositor stake membership.
