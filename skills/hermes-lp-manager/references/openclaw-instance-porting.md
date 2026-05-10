# Hermes OpenClaw Porting Checklist

Use this checklist to port Aerodrome Hermes LP automation into a local OpenClaw instance.

## Workspace

Required files:

- `skills/hermes-lp-manager/SKILL.md`
- `skills/hermes-lp-manager/commands.manifest.json`
- `skills/hermes-lp-manager/scripts/hermes_lp_agent.py`
- `skills/hermes-lp-manager/scripts/hermes_agent.py`
- `skills/hermes-lp-manager/scripts/hermes_heartbeat.sh`
- `skills/hermes-lp-manager/scripts/hermes_contract_smoke.sh`
- `skills/hermes-lp-manager/scripts/hermes_guardrail_audit.sh`

## Runtime

Required binaries:

- `python3` or `python`
- `bash` for heartbeat wrappers
- `cast` for live chain reads

Network:

- Base mainnet chain id `8453`
- Default RPC `https://base-rpc.publicnode.com`

## Secrets

Do not store raw keys in this repository.

Current Hermes mode is planning-only. A future execution adapter must keep signer material outside the repo and expose only a guarded send interface. Until then, `HERMES_MODE=execute` must fail closed.

Required runtime identity for actionable plans:

- `HERMES_DEPOSITOR_ADDRESS`: original depositor for the staked Aerodrome CL NFT.

## Scheduler

Recommended cron payload:

```bash
HERMES_DEPOSITOR_ADDRESS=0xDepositor \
HERMES_OUTPUT_MODE=highlight \
bash skills/hermes-lp-manager/scripts/hermes_heartbeat.sh --once
```

Recommended cadence:

- Hermes heartbeat: every 30 minutes
- Hermes guardrail audit: every 60 minutes

## Validation

Run before enabling cron:

```bash
python -m unittest discover -s skills/hermes-lp-manager/tests
bash skills/hermes-lp-manager/scripts/hermes_contract_smoke.sh
bash skills/hermes-lp-manager/scripts/hermes_guardrail_audit.sh
```

## Execution Boundary

When a heartbeat returns `REBALANCE_COMPOUND_RESTAKE`, the current skill produces intent only:

1. Unstake from gauge.
2. Collect fees.
3. Decrease old liquidity.
4. Collect principal.
5. Mint replacement CL position.
6. Stake replacement NFT.
7. Verify post-state.

Do not broadcast any step until an explicit execution adapter simulates exact calldata, signs outside the repo, broadcasts sequentially, and verifies every tx hash.
