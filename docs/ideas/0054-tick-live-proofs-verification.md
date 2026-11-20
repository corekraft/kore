---
summary: Verification that the tick-live-proofs flag hands live-proof tickets to one live-proof pane at a time on the delivery host, so it can be activated.
hypothesis: With tick-ticket-queue and tick-live-proofs on in local, the tick starts at most one live-proof pane for the first queued live-proof ticket, holds the rest while it or a live run holds the host lease, and the pane records a verification outcome or a needs-info blocker without activating any flag.
expected-outcome: On the delivery host, one live-proof pane starts for the top live-proof ticket, no second one starts while it runs, tick.bound records the hold, and the run ends with a recorded verification outcome or a needs-info comment; no flag.activated event comes from the pane.
measurement: Read the ledger on the delivery host for session.launch, tick.bound, outcome and flag.activated events over the first live-proof run after activation, and the ticket's comments.
safety-pattern: feature-flagged
date: 2026-11-20
parent: 0052
issue: https://github.com/corekraft/kore/issues/1428
---

# Idea 0054: tick-live-proofs works in local
