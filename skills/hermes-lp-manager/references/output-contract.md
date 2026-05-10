# Hermes Output Contract

Hermes has four output modes. Keep these labels stable because cron relays, audits, and weaker agents depend on them.

## Summary

Required lines:

- `Hermes LP heartbeat`
- `- decision:`
- `- required heartbeat action:`
- `- range each side:`
- `- ticks each side now:`
- `- configured ticks each side:`
- `- stake integrity:`
- `- pending reward now:`
- `- est apr:`
- `- blockers:`
- `- tx_plan_items:`

## Contract

Required labels:

- `decision:`
- `required heartbeat action:`
- `range each side:`
- `ticks each side now:`
- `configured ticks each side:`
- `min headroom:`
- `stake integrity:`
- `pending reward now:`
- `est apr:`
- `post-action tokenId/status:`

## Highlight

Required labels:

- `Heartbeat update`
- `Highlights:`
- `Key status:`
- `- Range each side:`
- `- Ticks each side now:`
- `- Pending reward now:`
- `- Est APR:`
- `Outcome:`

## Raw

Raw mode must be valid JSON and include:

- `decision`
- `required_heartbeat_action`
- `gates`
- `range_state`
- `snapshot`
- `tx_plan`
