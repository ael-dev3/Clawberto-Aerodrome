# Aerodrome Pool Intel

OpenClaw skill set for deterministic Aerodrome pool intelligence on Base (chain id 8453).

## Scope

- Enumerate Aerodrome pools from on-chain factory registry and voter relationships.
- Enrich each pool with:
  - liquidity / 24h volume
  - liquidity provider fee APR
  - gauge emission APR
  - bribe fee APR (weekly)
  - explicit safety score and tiering
  - gauge status and reward contract traceability
- Estimate gas for `deposit(uint256)` and `withdraw(uint256)` for weak-LLM-friendly execution planning.

## Repository Layout

- `skills/aerodrome-pool-intel/` OpenClaw skill files.
- `metadata/` Cached live contract manifests.
- `runs/` Latest and simulated scan outputs.

## Supported Entrypoints

### Full scan

```bash
cd /Users/marko/Clawberto-Aerodrome
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --max-pools 200 \
  --strict \
  --include-gas-estimates
```

### Scan with custom filters

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --only-gauged \
  --sort-by safety \
  --min-liquidity-usd 50000 \
  --out-json runs/aerodrome-pool-intel/custom.json \
  --out-csv runs/aerodrome-pool-intel/custom.csv
```

### Find a token pair with full on-chain scan

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --pool-source chain \
  --token-filter 0x767A739D1A152639e9Ea1D8c1BD55FDC5B217D7f \
  --token-filter 0x4200000000000000000000000000000000000006 \
  --sort-by liquidity \
  --strict
```

The two `--token-filter` flags above find pools containing both VEIL and WETH.
If the result is empty, use `--max-pools` + `--match-all-token-filters` to validate the query shape.

### Contract read helper

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_contract_call.py \
  --to 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5 \
  --sig 'weights(address)(uint256)' \
  --arg 0x5c3f18f06cc09ca1910767a34a20f771039e37c0 \
  --json
```

### Contract discovery

```bash
python3 skills/aerodrome-pool-intel/scripts/discover_aerodrome_contracts.py \
  --max-factories 20 \
  --max-pools-per-factory 500
```

## Safety Guarantees

- Read-only mode only (`cast call` and `cast estimate` used on demand).
- RPC and HTTP calls are host allowlisted.
- Optional strict mode fails fast when APR/safety values are non-finite.
- Official ETH/USDC pools are hard-pinned to safety score `10.0`.
- Every row includes explicit `warnings`, `safety_reasons`, and `errors`.

## Quick Local Simulation

```bash
bash skills/aerodrome-pool-intel/scripts/run_local_sims.sh
```

## Heartbeat / Operational Runbook

See `HEARTBEAT.md` for a 30-minute cron pattern and execution controls.

## Contracts Snapshot

Address references live in:
- `skills/aerodrome-pool-intel/SKILL.md`
- `skills/aerodrome-pool-intel/references/contracts.md`
- `metadata/live_contracts_base_mainnet.json`
