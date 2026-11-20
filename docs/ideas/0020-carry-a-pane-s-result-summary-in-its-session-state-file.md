---
summary: Carry a pane's result summary in its session state file
hypothesis: If session wait stores the pane result's summary in .kore/state/sessions/<name>.json and returns it in its JSON, the main session reads a finished pane's result from that record instead of scraping the pane with herdr agent read.
expected-outcome: The main session's herdr agent read and pane read calls per finished pane fall by at least three quarters, against 278 reads over 15-16 Nov, while tokens per merged change do not worsen.
measurement: mainSession.paneReadsPerFinishedPane in harness flow report, from the retro.main-session event retro-scan records from transcripts.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: mainSession.paneReadsPerFinishedPane
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/937
outcome: inconclusive
---

# Idea 0020: Carry a pane's result summary in its session state file

Decided in [ADR 0123](../decisions/0123-the-main-session-waits-and-sends-through-harness-tools-not-guards.md).

- **session wait, not notify.** The idea as filed had `session notify` write
  the summary; a writer pane's sandbox (ADR 0095) cannot write the main
  checkout's state file, and notify stays outcome-only. `session wait`, run by
  the caller, already reads the pane and records the outcome, so it stores the
  text printed before the RESULT line as `result.summary`, ANSI stripped and
  length capped. The `pane.finished` ledger event stays outcome-only.
- **The flag.** `pane-result-summary`, off in every overlay, gates one line of
  the main session's SessionStart brief that names `result.summary`. The field
  itself is additive and ships unflagged.
- **The primary.** The main session's pane-result reads per `pane.finished`,
  down, read as `mainSession.paneReadsPerFinishedPane` in the flow report from
  the scan's `retro.main-session` event. `metrics.tokensPerIdea` as filed is
  idea 0007's primary and a shared metric, so it is not this idea's primary.
- **The window** opens only while `orchestrator-tick` is off; a tick turned on
  mid-window makes it insufficient and restarts it.

## Outcome

- Result: inconclusive
- Kind: experiment
- Source: journal
- Evidence: Window never opened, as 0019; 891 pane reads over 552 finished panes (about 1.6 per pane), baseline has no per-pane denominator
- Recorded: 2026-11-20

The window never opened; 891 pane reads over 552 finished panes (about 1.6 each), with no baseline denominator.
