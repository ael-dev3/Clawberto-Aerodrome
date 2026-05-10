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
- Slipstream CL min-unstake deployment for managed CL pools:
  - `CL PoolFactory`: `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`
  - `CL GaugeFactory`: `0x385293CaE378C813F16f0C1334d774AdDDf56AbB`
  - `CL NonfungiblePositionManager`: `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`
  - `CL SwapRouter`: `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F`
  - `CL Quoter`: `0x514c8B5f54112481E28028F1166Bd78501089259`
  - `CL MixedQuoterV2`: `0xb4A9E5Fc0727BEF09D819fcfc5ece8CA9bCf09EB`
  - `CL MixedQuoterV3`: `0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555`

### Managed pool focus: CL200-LFI/USDC

- Pool: `0x8343c68279587498526114e6385f0a87f248e0d9`
- Gauge: `0xe9c73937382c621770f5b7018a407c0749df6aae`
- NFT manager: `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53`
- Token0 LFI: `0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3` (18 decimals)
- Token1 USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals)
- Tick spacing: `200`; fee: `10000` = 1% (1e6 denominator)
- Runtime Hermes-managed NFT: discover from on-chain state, runtime state/logs, explicit `HERMES_EXTRA_TOKEN_IDS`, and bounded candidate scans; do not trust a hardcoded token id.
- Reference/tracked historical NFT: `341002`
- Live dashboard: `https://ael-dev3.github.io/Clawberto-Aerodrome/`
- Dashboard data source: `src/positions.ts` for optional release sync only; it is not the LP-control source of truth.
- Dashboard presentation contract: keep the LP range console first, no marketing hero, embed the live GeckoTerminal candle/range chart in the first panel, show the current Hermes-managed NFT as the primary active card, and collapse unreadable reference/watchlist NFTs into LP history diagnostics instead of noisy active error cards.
- Full LP management notes: `references/cl-lfi-usdc-lp-management.md`

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

For a two-token classic volatile/stable lookup (e.g., VEIL+WETH), the scanner uses factory pair-resolve calls first.
This bypasses metadata snapshot lag and is the recommended path for weak LLM prompts asking for
specific classic pairs. Expected path:
1. Query chain factory addresses from `FactoryRegistry`.
2. Resolve pair directly via `getPool(token0, token1, stable)` in both stable modes.
3. Return matched pools, if any.

For Slipstream CL pools such as `CL200-LFI/USDC`, use the CL factory shape `getPool(token0, token1, int24 tickSpacing)` and the LP-management reference below. Do not coerce CL tick spacing into a `stable` boolean.

## LP management workflow for CL positions

For the managed `CL200-LFI/USDC` pool, load and follow `references/cl-lfi-usdc-lp-management.md` before planning stake, unstake, claim, withdraw, mint, swap, or rebalance actions.

Weak-LLM-safe gates copied from the Kittenswap control plane:

1. Status first: read pool `slot0`, NFT `positions(tokenId)`, `ownerOf(tokenId)`, gauge `rewardRate`, `left`, and depositor-specific `stakedContains`/`earned` when the depositor is known.
2. Treat `ownerOf(tokenId) == gauge` as staked custody, not as the human owner. Recover/require the original depositor before gauge `withdraw` or `getReward`.
3. If staked, principal management starts with gauge `withdraw(uint256)` from the depositor; do not call position-manager `decreaseLiquidity` while the NFT owner is the gauge.
4. Remove old liquidity in fixed order: `collect -> decreaseLiquidity -> collect`; `burn` only with explicit close intent after liquidity and owed tokens are zero.
5. Mint replacement CL positions through `NonfungiblePositionManager.mint((address,address,int24,int24,int24,uint256,uint256,uint256,uint256,address,uint256,uint160))`, with token order normalized, ticks aligned to `200`, ERC20 approvals targeting the NFT manager, and fresh direct simulation before signing.
6. Post-mint managed strategy defaults to immediate gauge staking: approve NFT to gauge, `deposit(uint256)`, then verify `ownerOf(tokenId) == gauge` and `stakedContains(depositor, tokenId)`.
7. Every LP enter/exit/rebalance must verify on-chain post-state and persist runtime state before reporting LP-control completion. `src/positions.ts`, position-history, and GitHub Pages updates are opt-in release/dashboard sync work, not the 30-second hot path.
8. All execution support remains plan/verification-first. Do not claim an on-chain action was executed unless a signed tx hash is verified.

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

1. Pool-intel scans remain read-only. No signing or private key handling in scanner scripts.
2. LP-management flows must be plan/verification-first. Only broadcast if an explicit signer path exists and every printed gate is `PASS`.
3. All reads use `cast call` over HTTPS RPC and HTTP reads are host allowlisted.
4. Official ETH/USDC pair is hard-pinned to `10/10` safety.
5. In strict mode, the run fails on non-finite APR/safety values or invalid totals.
6. Every output must include explicit reasons for risky pools.
7. For CL min-unstake pools, never use classic pool ABI assumptions: use `getPool(address,address,int24)`, 6-field `slot0`, and the CL NFT/gauge staking model documented in `references/cl-lfi-usdc-lp-management.md`.
8. For managed LP changes, keep the executor focused on LP uptime/profitability. Dashboard sync may update `src/positions.ts`, rebuild/test, push, and verify `https://ael-dev3.github.io/Clawberto-Aerodrome/` only when explicitly requested or `HERMES_DASHBOARD_SYNC=1` is set.

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
