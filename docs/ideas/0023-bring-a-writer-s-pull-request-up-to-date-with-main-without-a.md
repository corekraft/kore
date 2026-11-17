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

### Cut by cause (#977): not taken

No counts were produced, so the four classes (conflict, behind-and-ready, main-fixed, other) have no figures, and neither the total nor the per-follow-up state fields exist.

Why the cut could not be taken:

- The follow-up text exists only in session transcripts. The ledger holds one `session.send` event since 2026-11-12 (`harness ledger list`), against 399 writer launches (`session.launch`, role writer) in the same window.
- The retro scan (`harness hook retro-scan`) counts without reporting text, by design. Its `mainSession.rawSends` figure (1308) does not split by target or by content, so it cannot give the origin/main count.
- A shell read of transcripts from this writer worktree is refused by the `role-worktree` guard. The file reader has no search across the 946 sessions in the window.
- Launching a reader pane to do the cut was outside the job of the session that took this ticket.

What this confirms: the ledger cannot read `rework.mainFollowUpsPerWriterSession` for this window, as the spec states, because it holds one `session.send` event against 399 writer launches. The "100 follow-ups in 82 sessions" figure and the 0.61 baseline in #816 were not re-derived.

### Go or no-go for the tick notice ticket (#980)

**No-go, until a cut is recorded here.** The rule in #977 is go when conflict plus behind-and-ready is not smaller than main-fixed, and no-go when main-fixed is the largest class. Neither side has a count, so the rule cannot be applied. #980 does not start on this evidence. A reader pane should repeat the cut over the transcripts, with the four counts, the total and the method, and then this line is decided again.
