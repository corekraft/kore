---
status: accepted
summary: Refines ADR 0077: a pull request references, and does not close, an issue whose outcome needs a live or nightly run; the issue closes once a green run is recorded on it.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0097: An outcome issue closes on recorded proof, not on merge

Source: [`infra/plans/3-agent-harness.md` § Retrospective 2026-11-12 (evening)](../../infra/plans/3-agent-harness.md#retrospective-2026-11-12-evening)

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md)

## Context

ADR 0077 lets a cluster-facing change merge before its live run: the live proof
gates turning the flag on, not the merge. GitHub closes an issue as soon as a
pull request that says "Closes #N" merges. For an issue whose outcome is a
passing live or nightly run, those two facts disagree: the issue reads as done
while the proof is still owed.

That happened on 2026-11-13 (UTC). #358 said "Closes #356", so #356 closed at
03:52Z when it merged. Nightly runs 43361774153 and 43364720238 then failed and
43369451166 was cancelled. The sixth retrospective found #356 closed with no
passing run, and the #366 handoff carried it as settled.

## Decision

- A pull request for an issue whose outcome needs a live run or a nightly run
  references it with "Refs #N". It does not use "Closes", "Fixes" or
  "Resolves" for that issue.
- The issue closes when a green run is recorded on it, with the run named in
  the closing comment.
- An issue whose outcome the merge itself delivers (docs, a refactor, a change
  the fast suites prove) still closes on merge.
- This is guidance in `AGENTS.md` first. A check on the closing keyword starts
  in audit mode if the guidance alone does not hold.

## Consequences

- An open issue means proof is owed, so handoff notes and the concierge can
  read state from the tracker without rechecking each run.
- Someone has to close the issue after the green run. Until the delivery loop
  does it, that is the orchestrator's step, and a forgotten one leaves an issue
  open that is in fact done, which is the safer error.
- The writer has to judge whether an outcome needs a run. A wrong call in the
  "Closes" direction repeats #356, so when unsure, use "Refs".
- #356 itself is not reopened by this ADR; the owner or the orchestrator
  decides that.
