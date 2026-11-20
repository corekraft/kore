---
summary: Bring a writer's pull request up to date with main without a main-session message
hypothesis: If the harness notices that a writer's pull request conflicts with main, or is ready to merge but for being behind, and sends the writer one signed message to merge origin/main, the main session stops typing those follow-ups
expected-outcome: Since 2026-11-12 the main session sent 69 follow-up sends (cut #977): 40 conflict, 5 behind-and-ready, 13 main-fixed, 11 other. Conflict and behind-and-ready together (45) fall to at most 4 in 14 days (10 percent of 45), with the main-fixed count (13) stated beside them; main-fixed is not a target
measurement: Primary: the retro scan's count of writer follow-ups that name origin/main per 14 days, counting herdr prompts and session send, classed as in the cut. The flow report path for the hypothesis is rework.mainFollowUpsPerWriterSession, which reads insufficient history until the notice writes its events. Guard metrics: rework.followUpsPerWriterSession, tokensPerMergedChange.current and sendBacksPerMergedChange.current
safety-pattern: feature-flagged
date: 2026-11-17
kind: harness
hypothesis-metric: rework.mainFollowUpsPerWriterSession
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/965
outcome: inconclusive
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

### Triggers and the notice (spec #971)

- **Conflict**: the writer's pull request is in a conflicting merge state with main.
- **Behind and ready**: the judge precheck has no failure, CI is green, and the only thing holding the merge is being behind main.

A pull request that is behind with checks pending or red gets no notice. The tick sends one signed follow-up per pull request head and main head. The text repeats the writer's own rule (merge origin/main, never rebase or force-push) and says which trigger fired. It also says: if your brief pins a live proof to your head, reply `pinned: no change` and stop.

The writer decides whether its proof is pinned. No record or state file of a pinned head is read by the tool. A later pass reads that exact reply, on the same heads, as an answer and not as a stalled writer.

### Dropped: the harness updates the branch itself (#979)

The self-update half of the first draft is dropped. The harness notifies and never pushes, updates or merges a writer's branch. Four reasons:

- one owner per resource: the writer owns its branch;
- a new head voids a pinned live proof;
- the judge counts principles review only from reviews made after the head commit, so a harness push would force a new review;
- a textually clean merge can still break behaviour.

### Decision: no ADR

No ADR was written. The rule is already stated by "one owner per resource" in AGENTS.md, and the rejection is recorded here. An ADR would be number 0125 if the owner wants one.

### Window

The window for this idea opens after idea 0015's window closes (ADR 0119). Building behind the flag may proceed meanwhile; activation waits.

## Outcome

- Result: inconclusive
- Kind: experiment
- Source: journal
- Evidence: Window never opened: behind-main-notice is off and the tick only started 2026-11-20; 0 notices sent vs baseline 45 sends, target at most 4
- Recorded: 2026-11-20

The window never opened: behind-main-notice is off, 0 notices were sent, and the target of at most 4 is untested.
