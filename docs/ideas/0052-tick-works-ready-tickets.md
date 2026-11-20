---
summary: orchestrate tick builds its queue from every open ready-for-agent issue with no open blocker, no open sub-issue, no assignee and no paused or spec label, not only from idea records; behind a local flag, off.
hypothesis: If the tick's queue includes plain ready-for-agent tickets and leaves out issues with an open blocker, an open sub-issue, an assignee or the paused label, the main session stops recomputing the frontier and starting writers by hand, so main-session orchestration tokens per merged change fall while lead time per merged change holds.
expected-outcome: With the flag on in local, the orchestrate bucket of tokensByStagePerMergedChange falls against its trailing average over 14 days, leadTimePerMergedChange.current does not rise, and no tick-started writer works an issue that had an open blocker, an open sub-issue, an assignee or the paused label when it started.
measurement: Read tokensByStagePerMergedChange.current (orchestrate) and leadTimePerMergedChange.current from harness flow report --json over the 14 days after the flag turns on in local, against the 14 days before; check each tick-started writer's issue state at its session.launch time through gh for the exclusion rule.
safety-pattern: feature-flagged
date: 2026-11-20
kind: harness
hypothesis-metric: tokensByStagePerMergedChange.current
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/1419
---

# Idea 0052: The tick works any ready ticket and skips blocked and paused issues

Source: the 2026-11-20 retros ([determinism](../retros/2026-11-20-determinism-retro.md), [primitives](../retros/2026-11-20-primitives-retro.md), [cost](../retros/2026-11-20-cost-retro.md)) and the owner's request in the main session on 2026-11-20 that the tick work any ticket and respect blockers and `paused`.

## Problem

`buildQueue` in `tools/harness/src/queue/queue.ts` takes only idea records whose issue carries `ready-for-agent`, oldest first. A plain ticket never enters the queue, and an issue with an open blocker, an open sub-issue or the `paused` label is picked up as long as it is labelled. So the main session runs the frontier by hand: it recomputes the same issue search each round and starts each writer itself, which the 2026-11-20 cost retro found to be the largest single cost in the window.

## Change

Behind a new local flag (off):

- The queue takes every open issue labelled `ready-for-agent`, idea issues and plain tickets alike.
- It leaves out an issue with an open blocker (GitHub issue dependencies), an open sub-issue, an assignee, or the `paused` or `spec` label, and an issue whose body marks it as a grilling source.
- A plain ticket goes through the same steps as an idea: writer, `review run`, precheck, judge, send-back. It records no outcome, because it has no idea record.
- The rule is one deterministic function with unit tests, so the same issues always give the same queue.

## Out of scope

- Ordering by `horizon:next` and `horizon:then`, and a lane for `harness` work: a follow-up once the owner picks the lane rule.
- Live proofs, flag activation and owner decisions stay with the main session; a ticket that needs a live run is worked to its PR and stops there, as today.
