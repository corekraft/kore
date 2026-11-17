---
status: proposed
summary: Refines ADR 0123: the retro scan records its main-session event behind main-session-figures, off in every overlay, and only for the repository's own transcripts, so an unflagged scan writes no figure and a fixture folder never reaches the flow window.
date: 2026-11-16
last-verified: 2026-11-16
---

# ADR 0124: The main-session figures are recorded behind a flag, for the repository's own scans

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 6](../../infra/plans/11-agent-delivery-loop.md#step-6-orchestrator-and-concierge)

Refines: ADR 0123

## Context

ADR 0123 has the retro scan record one `retro.main-session` event per scan,
which the flow report reads as the three main-session figures. It does not say
whether that recording is flagged. The implementation needs an answer: a
recording that is always on would put figures in the ledger that nothing
has yet decided to measure, and a scan of a fixture folder would put its
window in the flow report.

## Decision

- **One flag.** The recording sits behind `main-session-figures`, declared off
  in the local and managed-example overlays. With the flag off, the scan writes
  no event and the report reads insufficient, never zero. Turning the flag on
  is an activation under the flag rules, so it waits on a recorded live-run
  outcome.
- **The repository's own scans only.** A scan of a `--dir` folder records
  nothing, so only the repository's own transcripts reach the flow window.
- **A window is its start.** A rescan from the same start replaces the earlier
  event, so it is counted once, and two windows whose starts differ both count.

## Consequences

- The three ideas' windows cannot open until the owner turns the flag on, so
  their measurement waits on that decision, which is the owner's to make.
- A flag that is off in every overlay adds no behaviour change, so the change
  merges without an approval step.
- A future flag or window rule is a change to this record.
