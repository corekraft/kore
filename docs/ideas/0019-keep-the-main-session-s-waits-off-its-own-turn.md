---
summary: Keep the main session's waits off its own turn
hypothesis: If the main session waits on pull request checks and pane results with one background harness wait instead of foreground sleep, until or seq loops, owner messages and pane results stop queuing behind its waits.
expected-outcome: The main session's foreground poll minutes per merged change fall by at least three quarters, against about 490 minutes in 669 polls over 15-16 Nov, while owner minutes per merged change and the p90 queue wait of owner messages (33 minutes) do not worsen.
measurement: mainSession.foregroundPollMinutesPerMerged in harness flow report, from the retro.main-session event retro-scan records from transcripts.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: mainSession.foregroundPollMinutesPerMerged
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/936
---

# Idea 0019: Keep the main session's waits off its own turn

Decided in [ADR 0123](../decisions/0123-the-main-session-waits-and-sends-through-harness-tools-not-guards.md).

- **No guard.** The idea as filed had the guard flag foreground polls; ADR
  0091 freezes new guards, so this ships as a tool and an instruction line.
- **The tool.** `harness wait` takes any mix of `--pr <n>` and
  `--session <name>` targets and returns when the first settles or its bound
  passes, naming the target and its state.
- **The flag.** `main-session-wait`, off in every overlay, gates one line of
  the main session's SessionStart brief that names `harness wait`.
- **The primary.** The main session's foreground poll minutes per merged
  change, down, read as `mainSession.foregroundPollMinutesPerMerged` in the
  flow report from the scan's `retro.main-session` event.
- **The window** opens only while `orchestrator-tick` is off; a tick turned on
  mid-window makes it insufficient and restarts it.
