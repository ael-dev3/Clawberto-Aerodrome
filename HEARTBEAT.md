# Aerodrome Pool Intel Heartbeat

## Purpose

Run a periodic safety-first Aerodrome pool scan with strict validation and deterministic outputs.

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

## Exit policy

- Heartbeat runs with `--strict`. Any arithmetic non-finite or runtime validation errors return non-zero.
- On success, timestamped artifacts are written, and `latest.json` / `latest.csv` are updated atomically.
- On failure, existing latest artifacts are left untouched so dashboards keep the last good snapshot.
