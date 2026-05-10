# Hermes Dashboard Sync Contract

Hermes must treat the LP status website as an operator-facing state surface.

When a future execution adapter enters, exits, claims, rebalances, burns, or restakes an LP position, it must update the dashboard data source after post-state verification. The dashboard should show:

- current active LP positions, or explicitly show no active positions
- token id, pool, gauge, tick lower, tick upper, current tick, and range headroom
- staked custody state and depositor stake membership
- pending reward snapshot when available
- history of previous LP positions and terminal status
- tx hashes and timestamps for verified state-changing actions

The current planning skill should include dashboard-sync as a required future post-action gate. The signer-backed one-cron executor in this repo is the current exception: when it performs a verified LP state change, it must modify `src/positions.ts`, run `npm test && npm run build`, commit/push to `main`, and wait for Pages before the cycle is considered complete.

If a GitHub push is rejected because the remote moved, resolve the rebase before reporting completion. A verified on-chain LP change with an unpushed dashboard is an incomplete cycle.
