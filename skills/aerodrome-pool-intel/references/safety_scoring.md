# Aerodrome Safety Scoring Rules

## Scale

- `10.0` highest, `0.0` lowest.
- Official ETH/USDC pair is hard pinned to `10.0` and tiered as `high` when both tokens match canonical addresses.
- Scores include explicit reasons for every deduction.

## Scoring inputs

1. **Liquidity depth**
   - `>= $1,000,000`: +1.5
   - `>= $250,000`: +1.0
   - `>= $50,000`: +0.4
   - `< $1,000`: -1.8

2. **Token quality**
   - Official token inclusion (ETH, USDC): +1.0 each
   - Suspicious symbols/text (`SCAM`, `RUG`, `HONEY`, `PUMP`, `INU`, etc.): -3.0 each
   - Missing token metadata (name/symbol): -1.0
   - Not-whitelisted token (via `voter.isWhitelistedToken`) with no price: -2.0

3. **Operational quality**
   - `stable` pools get +0.2
   - Fee rate above 30 bps (0.30%): -1.5
   - Pool missing gauge: -1.0
   - Gauge exists but `isAlive == false`: -1.8

4. **Freshness / listing context**
   - Pair older than 7 days: +0.5
   - Pair older than 30 days: +0.5
   - Newer than 7 days: +0.0
   - Newer than 2 days: -0.8

5. **Safety tier mapping**
   - `high`: `>= 8.5`
   - `medium`: `6.0 - 8.49`
   - `low`: `< 6.0`

## Deterministic guardrails

- `--strict` mode enforces finite APR/Safety values and non-empty scan outputs.
- Official ETH/USDC pair is always `10.0` and cannot be downgraded by heuristic deductions.
