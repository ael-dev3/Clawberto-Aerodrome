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
mkdir -p /Users/marko/Clawberto-Aerodrome/runs/aerodrome-heartbeat
chmod +x /Users/marko/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh
```

## Cron example

```cron
*/30 * * * * cd /Users/marko/Clawberto-Aerodrome && /bin/bash /Users/marko/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh >> /Users/marko/Clawberto-Aerodrome/runs/aerodrome-heartbeat/cron.log 2>&1
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

## Example looped heartbeat command

```bash
SCAN_LOOP=1 \
SCAN_LOOP_INTERVAL_SECONDS=1800 \
SCAN_AUTO_REBALANCE=1 \
SCAN_AUTO_REBALANCE_TOP_K=3 \
SCAN_AUTO_REBALANCE_MIN_LIQUIDITY=10000 \
/bin/bash /Users/marko/Clawberto-Aerodrome/skills/aerodrome-pool-intel/scripts/heartbeat_aerodrome_scan.sh
```

## Exit policy

- Heartbeat uses `SCAN_STRICT=1` for fail-fast behavior; with default `SCAN_STRICT=0` it will keep reports and still refresh `latest`.
- On success, timestamped artifacts are written, and `latest.json` / `latest.csv` are updated atomically.
- On failure, existing latest artifacts are left untouched so dashboards keep the last good snapshot.
