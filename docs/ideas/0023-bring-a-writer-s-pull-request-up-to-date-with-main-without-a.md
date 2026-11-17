---
summary: Bring a writer's pull request up to date with main without a main-session message
hypothesis: If the harness notices that a writer's pull request is behind or conflicts with main and updates the branch itself when it merges cleanly, or sends the writer the merge instruction when it conflicts, the main session stops typing those follow-ups
expected-outcome: Since 2026-11-12 the main session sent 100 follow-ups in 82 writer sessions telling the writer to merge or rebase on origin/main (conflicts, main fixed, merged dependencies). They fall to under 10 in 14 days, and rework.mainFollowUpsPerWriterSession falls
measurement: rework.mainFollowUpsPerWriterSession in harness flow report, with a count of writer follow-ups that name origin/main from the retro scan
safety-pattern: feature-flagged
date: 2026-11-17
kind: harness
hypothesis-metric: rework.mainFollowUpsPerWriterSession
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/965
---

# Idea 0023: Bring a writer's pull request up to date with main without a main-session message

## Notes

### Cut by cause (#977): recorded

A read-only reader, follow-up-cut-reader, ran a keyword search of the main session's transcripts since 2026-11-12 and classified each send by the reason its message states.

| Class            | Sends |
| ---------------- | ----- |
| conflict         | 40    |
| behind-and-ready | 5     |
| main-fixed       | 13    |
| other            | 11    |

Total: 69 send commands (about 73 pane deliveries, because one command fanned out to five writers), about 63 distinct sessions. The counts are sends, not PRs.

Method: keyword search of the transcripts, classified by the reason stated in the message text.

Caveats:

- Classification rests on message text, not on PR state at send time.
- Several messages are truncated, so their reasons are inferred.
- Nine sends were written to a file first, so their pane may overlap a counted pane.
- Reviewer and judge sends are not counted.

### Go or no-go for the tick notice ticket (#980): go

Rule from #977: go when conflict plus behind-and-ready is not smaller than main-fixed. Here 40 + 5 = 45 is not smaller than 13, and main-fixed is not the largest class. Result: **go for #980**.

Two gates stay on #980 (owner answers on #965):

- the window opens after idea 0015's window closes;
- orchestrator-tick must be on, since the tick sends the notice.
