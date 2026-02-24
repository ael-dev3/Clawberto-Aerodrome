---
name: aerodrome-pool-intel
description: OpenClaw skill for Aerodrome protocol intelligence on Base (chain id 8453). Enumerate all Aerodrome pools from registered factories and Voter registry, read pool/gauge/voting state, estimate APR (rewards, fee, and bribe layers), fetch 24h volume/liquidity from market data, compute explicit safety scores, and rank pools by APR, vote share, liquidity, volume, or safety for downstream staking or rebalancing decisions. Use when users need deterministic on-chain auditability, weak-LLM-safe ranking, contract safety triage, or repeatable protocol-wide inventory exports.
---

# Aerodrome Pool Intel

Use this skill for deterministic Aerodrome discovery and pool quality analysis on Base Mainnet. It is designed for weak-LLM-safe automation with strict read-only boundaries and explicit failure semantics.

## Protocol context

- Chain: Base Mainnet
- Chain ID: `8453`
- Default RPC: `https://base-rpc.publicnode.com`
- Core protocol addresses:
  - `Voter`: `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`
  - `VotingEscrow`: `0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4`
  - `FactoryRegistry`: `0x5C3F18F06CC09CA1910767A34a20F771039E37C0`
  - `PoolFactory`: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`
  - `GaugeFactory`: `0x35f35cA5B132CaDf2916BaB57639128eAC5bbcb5`
  - `AERO`: `0x940181a94A35A4569E4529A3CDfB74e38FD98631`
  - `WETH`: `0x4200000000000000000000000000000000000006`
  - `USDC`: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Quick start

```bash
cd /Users/marko/Clawberto-Aerodrome
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py --max-pools 120
python3 skills/aerodrome-pool-intel/scripts/aerodrome_contract_call.py --list-core
python3 skills/aerodrome-pool-intel/scripts/run_local_sims.sh
```

## Core workflows

### Full pool scan + ranking

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --max-pools 250 \
  --sort-by apr \
  --strict
```

### Safety-first ranking

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --only-gauged \
  --min-liquidity-usd 25000 \
  --sort-by safety
```

### Fee-heavy ranking

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --sort-by volume \
  --min-vote-share 0.01
```

### Market-only scan (no external market API)

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --skip-market \
  --max-pools 200
```

### Token-specific pair search

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_pool_scan.py \
  --pool-source chain \
  --token-filter 0x767A739D1A152639e9Ea1D8c1BD55FDC5B217D7f \
  --token-filter 0x4200000000000000000000000000000000000006 \
  --match-all-token-filters \
  --sort-by safety \
  --strict
```

`--token-filter` can be repeated for both sides of a pair or broader "contains token" search.

For a two-token lookup (e.g., VEIL+WETH), the scanner uses factory pair-resolve calls first.
This bypasses metadata snapshot lag and is the recommended path for weak LLM prompts asking for
specific pairs. Expected path:
1. Query chain factory addresses from `FactoryRegistry`.
2. Resolve pair directly via `getPool(token0, token1, stable)` in both stable modes.
3. Return matched pools, if any.

## Output

- JSON: `runs/aerodrome-pool-intel/latest_report.json`
- CSV: `runs/aerodrome-pool-intel/latest_report.csv`

Each row includes:
- On-chain identity (`pool_address`, `token0`, `token1`, `stable`, `factory`, `gauge`, `is_gauge_alive`)
- Market state (`liquidity_usd`, `volume_h24_usd`, `fee_rate_bps`, `pair_created_at_iso`)
- Incentive model (`vote_weight`, `vote_weight_pct`, `reward_apr_pct`, `fee_apr_pct`, `bribe_apr_pct`, `total_apr_pct`)
- Safety (`safety_score`, `safety_tier`, `safety_reasons`)
- Audit columns (`errors`, `market_source`, `scan_notes`)

## Read-only contract calls

Use for deterministic single-call checks:

```bash
python3 skills/aerodrome-pool-intel/scripts/aerodrome_contract_call.py \
  --to 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5 \
  --sig 'length()(uint256)' \
  --json

python3 skills/aerodrome-pool-intel/scripts/aerodrome_contract_call.py \
  --to 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5 \
  --sig 'pools(uint256)(address)' --arg 0
```

`--list-core` prints the supported allowlist.

## Contracts discovery pathway

Create an audit snapshot of live contracts and pair factories:

```bash
python3 skills/aerodrome-pool-intel/scripts/discover_aerodrome_contracts.py \
  --max-pools 4000 \
  --write-json metadata/live_contracts_base_mainnet.json \
  --write-csv metadata/live_contracts_base_mainnet.csv
```

Use this before large scans if you want stable contract manifests in CI.

## Non-negotiable execution constraints

1. Read-only only for this skill. No signing, no private key handling.
2. All reads use `cast call` over HTTPS RPC and HTTP reads are host allowlisted.
3. Official ETH/USDC pair is hard-pinned to `10/10` safety.
4. In strict mode, the run fails on non-finite APR/safety values or invalid totals.
5. Every output must include explicit reasons for risky pools.

## Operational controls

- Run local validation:
```bash
bash skills/aerodrome-pool-intel/scripts/run_local_sims.sh
```
If default RPC gets throttled, set:
```bash
SIM_RPC_URL=https://base-mainnet.public.blastapi.io bash skills/aerodrome-pool-intel/scripts/run_local_sims.sh
```

- Run periodic heartbeat scan:
```bash
bash skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh
```
- With looped 30-minute heartbeat and auto-rebalance recommendations:
```bash
SCAN_LOOP=1 \
SCAN_LOOP_INTERVAL_SECONDS=1800 \
SCAN_AUTO_REBALANCE=1 \
bash skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh
```

Use `HEARTBEAT.md` for 30-minute scheduling variables and cron examples.
