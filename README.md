# Aerodrome Pool Intel

OpenClaw skill set for deterministic Aerodrome pool intelligence on Base (chain id 8453).

This repo now includes a Hermes LP control-plane skill for cron-safe monitoring and guarded planning of the managed Aerodrome Slipstream `CL200-LFI/USDC` position.

## Live LP Dashboard

- Hosted dashboard: https://ael-dev3.github.io/Clawberto-Aerodrome/
- Shows CL200-LFI/USDC live pool tick, current price, active LP range status, gauge custody, top-of-page tracked wallet balances, AERO rewards, and LP history.
- Tracks the Clawberto agent wallet `0xC979efda857823bcA9A335a6c7b62A7531e1cFEA` and Ael manual wallet `0x8db2Ef0C439ca22f736A66988a5491a6219F679e`.
- Includes a GeckoTerminal-backed LFI price candle chart with each readable NFT range projected as live price bands.
- Adds bottom-of-page LFI analytics: 1h/2h/6h/12h/24h/48h price windows, pool-side USD sizing, pending emissions, APR stack, IL/hold delta, volatility-based range suggestion, and a manual-human-vs-AI-agent profitability index.
- The head-to-head score shows each wallet's confirmed LP position size, tracked wallet value, current APR, pending emissions, LFI/USDC LP balance split, range headroom on each side, and confirmed LP NFT count. A wallet always receives ERC-20 balance tracking, but only receives LP credit when the dashboard can attribute a live NFT to that wallet/depositor.
- Current LP registry: active Hermes NFT `#345949`, range `-365000 → -364800`, staked in the CL gauge with `stakedContains(0xC979...cFEA, 345949) == true` at the remediation check. The previous empty-registry state was corrected after closing stale failed one-cron leftovers.
- Closed stale leftovers during remediation: wallet-owned unstaked NFTs `#345349`, `#345384`, `#345412`, plus additional orphan `#345174` discovered from one-cron logs/state.
- Source of truth for displayed active positions: `src/positions.ts`. Every future Aerodrome LP enter/exit must update this registry and redeploy the GitHub Pages site.

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
- `skills/hermes-lp-manager/` Hermes LP heartbeat and rebalance-planning rails.
- `metadata/` Cached live contract manifests.
- `runs/` Latest and simulated scan outputs.

## Supported Entrypoints

### Hermes LP heartbeat

```bash
python3 skills/hermes-lp-manager/scripts/hermes_lp_agent.py heartbeat \
  --token-id 341002 \
  --depositor "$HERMES_DEPOSITOR_ADDRESS" \
  --output-mode highlight \
  --out-json runs/hermes-lp-manager/latest.json \
  --out-summary runs/hermes-lp-manager/latest.txt
```

Strict JSON entrypoint for OpenClaw-style loops:

```bash
printf '%s' '{"command":"heartbeat","args":["--from-snapshot","skills/hermes-lp-manager/tests/fixtures/hold-snapshot.json"]}' \
  | python3 skills/hermes-lp-manager/scripts/hermes_agent.py
```

Hermes execution remains planning-only until a separate signer adapter is implemented. `HERMES_MODE=execute` fails closed by design.

### Full scan

```bash
cd /Users/marko/.openclaw/workspace/Clawberto-Aerodrome
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
The scanner resolves exact two-token pairs via factory `getPool(token0, token1, stable)` first.
That avoids stale metadata snapshots and is the fastest reliable path for VEIL-style pair checks.
If no result is returned, this is usually either:
- pair does not exist on Base,
- wrong token order/network, or
- factory signature changed for that chain version.
Use `--match-all-token-filters` only when you explicitly want exact set matching.

### Reliability knobs (retry/backoff)

Transient RPC and HTTP failures now use bounded exponential backoff by default.

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --rpc-max-retries 3 \
  --rpc-retry-base-ms 350 \
  --rpc-retry-max-ms 2500 \
  --http-timeout-sec 10 \
  --http-max-retries 2 \
  --http-retry-base-ms 250 \
  --http-retry-max-ms 2000
```

Environment overrides are also supported:
- RPC: `AERODROME_RPC_MAX_RETRIES`, `AERODROME_RPC_RETRY_BASE_MS`, `AERODROME_RPC_RETRY_MAX_MS`
- HTTP: `AERODROME_HTTP_TIMEOUT_SEC`, `AERODROME_HTTP_MAX_RETRIES`, `AERODROME_HTTP_RETRY_BASE_MS`, `AERODROME_HTTP_RETRY_MAX_MS`
- Heartbeat-compatible aliases: `SCAN_RPC_*` and `SCAN_HTTP_*` (same suffixes)

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
- Transient retry/backoff is bounded and only applies to read paths.
- Optional strict mode fails fast when APR/safety values are non-finite.
- Official ETH/USDC pools are hard-pinned to safety score `10.0`.
- Every row includes explicit `warnings`, `safety_reasons`, and `errors`.

## Quick Local Simulation

```bash
bash skills/aerodrome-pool-intel/scripts/run_local_sims.sh
```

If provider rate limits affect the default RPC, pass an alternate endpoint:

```bash
SIM_RPC_URL=https://base-mainnet.public.blastapi.io bash skills/aerodrome-pool-intel/scripts/run_local_sims.sh
```

## Local Validation

Run the offline unit tests and parser checks before changing scan logic:

```bash
python -m unittest discover -s skills/aerodrome-pool-intel/tests
python -m unittest discover -s skills/hermes-lp-manager/tests
python skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py --help
python skills/aerodrome-pool-intel/scripts/aerodrome_contract_call.py --help
bash skills/hermes-lp-manager/scripts/hermes_contract_smoke.sh
```

## Heartbeat / Operational Runbook

See `HEARTBEAT.md` for a 30-minute cron pattern and execution controls.

## Contracts Snapshot

Address references live in:
- `skills/aerodrome-pool-intel/SKILL.md`
- `skills/hermes-lp-manager/references/lfi-usdc-pool.json`
- `skills/aerodrome-pool-intel/references/contracts.md`
- `skills/aerodrome-pool-intel/references/cl-lfi-usdc-lp-management.md`
- `metadata/live_contracts_base_mainnet.json`
