---
summary: Verification that the hc-sessions flag runs harness sessions on hc terminals in local, so it can be activated. Turning it on needs this idea's recorded verification outcome.
hypothesis: With hc-sessions on in local, session spawn, wait, send, check and close run on hc terminals and the ledger records them from hc events.
expected-outcome: A spawned writer reports through session report, session wait returns on that report, and the ledger shows the terminal events for it.
measurement: Read the ledger's terminal-source events and the session commands' output on the first loop run after activation; the live runs on kore-agents recorded on #1783 passed these.
safety-pattern: feature-flagged
date: 2026-11-23
issue: 1783
parent: 1765
outcome: confirmed
---

# Idea 0081: hc-sessions works in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: owner-waiver
- Flag: hc-sessions
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/1783#issuecomment-7089255157
- Recorded: 2026-11-23

Owner waived the remaining live run for local. Two live runs on kore-agents passed spawn, send, wait, report, check, close, the ledger terminal events, three writers, the reader guard and harness wait --pr; the removed-store-item case, the worktree-settings loosen attempt, a permission-prompt block, the kore-writer token and the small-split read were not run.
