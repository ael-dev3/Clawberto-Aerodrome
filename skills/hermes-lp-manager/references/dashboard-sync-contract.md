# Hermes Dashboard Sync Contract

Hermes must treat the LP status website as an optional operator-facing state surface. Runtime/on-chain state is authoritative for LP control; `src/positions.ts` must not be used as the hot-path source of truth.

When a release/dashboard sync is explicitly requested or `HERMES_DASHBOARD_SYNC=1` is set, update the dashboard data source after post-state verification. The dashboard should show:

- current active LP positions, or explicitly show no active positions
- token id, pool, gauge, tick lower, tick upper, current tick, and range headroom
- staked custody state and depositor stake membership
- pending reward snapshot when available
- history of previous LP positions and terminal status
- tx hashes and timestamps for verified state-changing actions

The signer-backed one-cron executor must prioritize LP uptime/profitability and post-state verification. Its scheduled hot path must not modify `src/positions.ts`, run tests/build, commit/push, pull/rebase, or wait for Pages. Those actions belong to a separate release workflow or the explicit `HERMES_DASHBOARD_SYNC=1` path.

If a dashboard release is requested and a GitHub push is rejected because the remote moved, resolve the rebase before reporting the dashboard release complete. A verified on-chain LP change is complete for LP-control purposes once post-state and runtime artifacts are verified, even if the optional dashboard release has not run.
