# Hermes Dashboard Sync Contract

Hermes must treat the LP status website as an operator-facing state surface.

When a future execution adapter enters, exits, claims, rebalances, burns, or restakes an LP position, it must update the dashboard data source after post-state verification. The dashboard should show:

- current active LP positions, or explicitly show no active positions
- token id, pool, gauge, tick lower, tick upper, current tick, and range headroom
- staked custody state and depositor stake membership
- pending reward snapshot when available
- history of previous LP positions and terminal status
- tx hashes and timestamps for verified state-changing actions

The current Hermes skill is planning-only. It must still include dashboard-sync as a required future post-action gate in execution adapter design, but it should not modify website files directly unless the user asks for website work in this repo.
