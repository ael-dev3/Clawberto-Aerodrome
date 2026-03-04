# Aerodrome Pool Intel Heartbeat

## Purpose

Run a periodic safety-first Aerodrome pool scan with deterministic outputs and optional strict mode.

## Recommended cadence

- Interval: every 30 minutes
- Output directory: `runs/aerodrome-heartbeat/`
- Required artifacts:
  - `latest.json`
  - `latest.csv`

## One-time setup

```bash
mkdir -p /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/runs/aerodrome-heartbeat
chmod +x /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh
```

## Cron example

```cron
*/30 * * * * cd /Users/marko/.openclaw/workspace/Clawberto-Aerodrome && /bin/bash /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh >> /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/runs/aerodrome-heartbeat/cron.log 2>&1
```

## Runtime knobs

- `SCAN_MAX_POOLS` (default `120`)
- `SCAN_WORKERS` (default `8`)
- `SCAN_HTTP_WORKERS` (default `6`)
- `SCAN_SORT_BY` (`apr` default)
- `SCAN_MIN_LIQUIDITY_USD` (default `0`)
- `SCAN_ONLY_GAUGED` (`1`/`0`, default `0`)
- `SCAN_OUT_DIR` (default `runs/aerodrome-heartbeat`)
- `SCAN_LOOP` (`1`/`0`, default `0`)
- `SCAN_LOOP_INTERVAL_SECONDS` (default `1800`)
- `SCAN_AUTO_REBALANCE` (`1`/`0`, default `0`)
- `SCAN_AUTO_REBALANCE_TOP_K` (default `5`)
- `SCAN_AUTO_REBALANCE_MIN_LIQUIDITY` (default `0`)
- `SCAN_AUTO_REBALANCE_MIN_APR` (default `0`)
- `SCAN_STRICT` (`1`/`0`, default `0`)
- `HEARTBEAT_OUTPUT_MODE` (`summary` default; `summary|contract|highlight|raw`)

Retry/backoff knobs passed through to the scanner:
- `SCAN_RPC_MAX_RETRIES`, `SCAN_RPC_RETRY_BASE_MS`, `SCAN_RPC_RETRY_MAX_MS`
- `SCAN_HTTP_TIMEOUT_SEC`, `SCAN_HTTP_MAX_RETRIES`, `SCAN_HTTP_RETRY_BASE_MS`, `SCAN_HTTP_RETRY_MAX_MS`

## Output modes

`heartbeat_aerodrome_scan.sh` supports:
- `summary` (default): concise operator summary
- `contract`: deterministic `key:value` lines for guardrails/smoke checks
- `highlight`: compact sectioned view for human scans
- `raw`: full JSON payload

Examples:

```bash
/bin/bash /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh --contract
/bin/bash /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh --highlight
HEARTBEAT_OUTPUT_MODE=raw /bin/bash /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh
```

Render mode output from an existing report without running a scan:

```bash
/bin/bash /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh --from-json runs/aerodrome-heartbeat/latest.json --contract
```

## Smoke checks

Contract/highlight output contract smoke script:

```bash
/bin/bash /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_contract_smoke.sh
```

## Example looped heartbeat command

```bash
SCAN_LOOP=1 \
SCAN_LOOP_INTERVAL_SECONDS=1800 \
SCAN_AUTO_REBALANCE=1 \
SCAN_AUTO_REBALANCE_TOP_K=3 \
SCAN_AUTO_REBALANCE_MIN_LIQUIDITY=10000 \
/bin/bash /Users/marko/.openclaw/workspace/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh
```

## Exit policy

- Heartbeat uses `SCAN_STRICT=1` for fail-fast behavior; with default `SCAN_STRICT=0` it will keep reports and still refresh `latest`.
- On success, timestamped artifacts are written, and `latest.json` / `latest.csv` are updated atomically.
- On failure, existing latest artifacts are left untouched so dashboards keep the last good snapshot.
