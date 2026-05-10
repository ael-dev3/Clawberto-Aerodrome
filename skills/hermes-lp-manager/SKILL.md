---
name: hermes-lp-manager
description: Hermes control-loop skill for Aerodrome Slipstream concentrated-liquidity LP management on Base. Use when a user needs cron-safe monitoring, position status reads, guarded rebalance or stake remediation plans, reward claim planning, transaction-intent queues, or automation rails for the managed CL200-LFI/USDC pool and related Aerodrome CL NFT positions.
---

# Hermes LP Manager

Use this skill to run Hermes as a deterministic LP control plane. Hermes can monitor a managed Aerodrome CL NFT, classify the current state, write cron heartbeat artifacts, and prepare guarded transaction plans for staking, claiming, unstaking, rebalancing, and restaking.

Hermes is not a blind signer. It must keep execution plan-first unless an explicit external signer adapter, depositor address, fresh simulations, and all gates are present.

## Managed Pool

Default target: `CL200-LFI/USDC` on Base mainnet.

- Pool config: `references/lfi-usdc-pool.json`
- Operational policy: `references/operational-policy.md`
- Defaults: `references/policy.defaults.json`
- Output labels: `references/output-contract.md`
- Transaction intent shape: `references/tx-intent-schema.json`
- Dashboard update contract: `references/dashboard-sync-contract.md`
- Machine command manifest: `commands.manifest.json`
- Source LP playbook: `../aerodrome-pool-intel/references/cl-lfi-usdc-lp-management.md`
- Strict JSON entrypoint: `scripts/hermes_agent.py`
- Cron wrapper: `scripts/hermes_heartbeat.sh`
- Python control loop: `scripts/hermes_lp_agent.py`
- Offline fixture matrix: `scripts/hermes_fixture_matrix.py`

The default pool uses:

- Pool: `0x8343c68279587498526114e6385f0a87f248e0d9`
- Gauge: `0xe9c73937382c621770f5b7018a407c0749df6aae`
- Token0 LFI: `0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3`
- Token1 USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Tick spacing: `200`
- Trading fee: `1.0%`

## Control Loop

Run the loop in this order:

1. Load the pool config and thresholds.
2. Read live pool, gauge, and NFT state with `cast call`, or load a saved snapshot with `--from-snapshot`.
3. Verify identity gates: pool, gauge, NFT manager, token order, tick spacing, owner/staked custody, and depositor-gated state when available.
4. Classify range health using current pool tick versus NFT `tickLower` and `tickUpper`.
5. Emit one decision: `HOLD`, `CLAIM_REWARD_RECOMMENDED`, `STAKE_REMEDIATION_REQUIRED`, `UNSTAKE_REBALANCE_RESTAKE_REQUIRED`, or `MANUAL_REVIEW`.
6. Write a transaction-intent plan. Do not broadcast from this skill unless a future execution adapter proves every gate as `PASS`.

## Commands

Live snapshot:

```bash
python3 skills/hermes-lp-manager/scripts/hermes_lp_agent.py health
python3 skills/hermes-lp-manager/scripts/hermes_lp_agent.py contracts
python3 skills/hermes-lp-manager/scripts/hermes_lp_agent.py snapshot \
  --token-id 341002 \
  --depositor "$HERMES_DEPOSITOR_ADDRESS" \
  --out-json runs/hermes-lp-manager/snapshot.json
```

Plan from a saved snapshot:

```bash
python3 skills/hermes-lp-manager/scripts/hermes_lp_agent.py plan \
  --snapshot runs/hermes-lp-manager/snapshot.json \
  --out-json runs/hermes-lp-manager/plan.json
```

Cron heartbeat:

```bash
HERMES_TOKEN_ID=341002 \
HERMES_DEPOSITOR_ADDRESS=0xYourDepositor \
bash skills/hermes-lp-manager/scripts/hermes_heartbeat.sh
```

Strict machine-facing entrypoint:

```bash
printf '%s' '{"command":"heartbeat","args":["--from-snapshot","skills/hermes-lp-manager/tests/fixtures/hold-snapshot.json"]}' \
  | python3 skills/hermes-lp-manager/scripts/hermes_agent.py
```

Output modes:

```bash
bash skills/hermes-lp-manager/scripts/hermes_heartbeat.sh --contract
bash skills/hermes-lp-manager/scripts/hermes_heartbeat.sh --highlight
HERMES_OUTPUT_MODE=raw bash skills/hermes-lp-manager/scripts/hermes_heartbeat.sh
```

Looped local runner:

```bash
HERMES_LOOP=1 \
HERMES_LOOP_INTERVAL_SECONDS=1800 \
HERMES_TOKEN_ID=341002 \
HERMES_DEPOSITOR_ADDRESS=0xYourDepositor \
bash skills/hermes-lp-manager/scripts/hermes_heartbeat.sh
```

## Runtime Knobs

- `HERMES_RPC_URL` defaults to `https://base-rpc.publicnode.com`.
- `HERMES_TOKEN_ID` defaults to the configured managed NFT.
- `HERMES_DEPOSITOR_ADDRESS` enables depositor-gated gauge reads and actionable plans.
- `HERMES_MODE` is `observe`, `propose`, or `execute`; default is `propose`.
- `HERMES_OUTPUT_MODE` is `summary`, `contract`, `highlight`, or `raw`.
- `HERMES_MIN_HEADROOM_TICKS` controls near-edge range warnings.
- `HERMES_MIN_HEADROOM_PCT` controls minimum side headroom as a fraction of range width.
- `HERMES_MIN_EARNED_AERO_WEI` controls reward-claim recommendations.
- `HERMES_MIN_TVL_USD` controls market-liquidity warnings.
- `HERMES_OUT_DIR` defaults to `runs/hermes-lp-manager`.
- `HERMES_LOOP` and `HERMES_LOOP_INTERVAL_SECONDS` control daemon-style runs.

## Safety Rules

- Treat `ownerOf(tokenId) == gauge` as gauge custody, not human ownership.
- Require the original depositor before planning `withdraw(uint256)`, `getReward(uint256)`, or `deposit(uint256)`.
- Never manage principal while the NFT is still owned by the gauge.
- Never use classic Aerodrome volatile/stable pool ABI calls for this CL pool.
- Align replacement ticks to tick spacing `200`.
- Regenerate plans after every tx, revert, tick movement, reward claim, or allowance change.
- Keep cron output deterministic: every run must write JSON and summary artifacts or fail without mutating the last good plan.
- After any future verified enter/exit/rebalance execution, update the LP status dashboard data source and history before marking the cycle complete.

## OpenClaw Rails

Mirror the proven Kittenswap pattern:

1. Prefer `commands.manifest.json` and `scripts/hermes_agent.py` for machine loops.
2. Use `--contract` output for guardrails and cron relays.
3. Use `--highlight` output for human chat/status surfaces.
4. Run `scripts/hermes_contract_smoke.sh` before trusting scheduler output.
5. Run `scripts/hermes_guardrail_audit.sh` before enabling or changing cron.
6. Run `scripts/hermes_fixture_matrix.py` when changing decision logic or output formatting.
7. Keep live execution in a future separate adapter, like the HyperEVM execute layer; this skill owns monitoring and plan generation only.
