---
summary: Determinism retro, 2026-11-18T02:13:52Z to 2026-11-20, revised after its grill and the owner's decisions. Two changes to make now (scan clipping and brief exclusion), one idea (pr check lists the matching patterns), one flow figure (merges past a failing precheck, upper bound 33 of 102, 3 of them cluster-facing no-behaviour-change), one measurement note on ideas 0021 and 0035, one diagnostic, two items deferred. No guard proposed. Proposals only; none filed.
date: 2026-11-20
last-verified: 2026-11-20
---

# Determinism Retro 2026-11-20

This retro looks for decisions agents make by judgment, or by hand, where the
same input should always give the same answer and a wrong or inconsistent
answer is costly. It also covers two related cases: code that already decides
deterministically but that agents work around, and decisions that need real
judgment and should stay with agents.

It was grilled after its first draft (PR #1410). This revision applies every
verdict and evidence correction from that grill, and records the owner's
decisions of 2026-11-20 as decided. Neither the grill nor the owner's list is
committed, so this doc restates what they settled.

## Scope and sources

The window runs from 2026-11-18T02:13:52Z, the last retrospective, until
2026-11-20T08:35Z. Three session counts describe it. They differ because each
source counts a different thing:

| Source                                   | Count | What it counts                                                                                       |
| ---------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| Retro scan (`hook retro-scan --strict`)  | 250   | Transcripts whose last line falls in the window, including the main session that began on 2026-11-12 |
| Transcript files modified in the window  | 253   | Files in the main-checkout and worktree project folders, including short and forked sessions         |
| Spawned panes in `.kore/state/sessions/` | 190   | Panes started by `session spawn` in the window; the main session is not one                          |

- **Ledger.** 38,781 events from `.kore/state/ledger.jsonl` fall in the window.
- **Retro scan.** Its first run ran out of heap at 4 GB. The rerun had no
  `--evidence`, so guard blocks have counts but no verdicts.

Every count below names its source:

- **ledger**: event kinds in `.kore/state/ledger.jsonl`
- **scan**: the retro scan output
- **transcripts**: `session-id:line`
- **gh**: `gh pr view` file lists
- **journal**: `.kore/state/journal/local.jsonl`

No transcript text is quoted.

## Owner decisions (2026-11-20, decided)

1. **The guard freeze stays** (ADRs 0091, 0101 and 0123). No new guard rule,
   audit mode included. That rules out a warning on raw herdr sends, on a bare
   `gh pr merge` or on heredoc edits. This drops the guards first proposed in
   findings 1 and 3.
2. **No `--override` or `--accept` on `judge merge` in this retro.** If one is
   wanted later, it needs its own proposal and ADR. This drops the `--waive`
   flag first proposed in finding 1.
3. **The ADR refining ADR 0124 is held** until the finding 5a rerun shows the
   size of the double count (finding 5b).
4. **Opus for the 2026-11-20 retro writers** was a special case the owner
   chose. It is not an issue, and no saving is proposed for it.
5. **Read-only guard: no parsing of loops or command substitution.** Only the
   scratchpad-redirect quick fix to the existing rule goes ahead. This bounds
   finding 6.

The grill raised two more owner questions:

- **The bare-herdr question parked in ADR 0123** stays parked there, under
  that ADR. This retro does not resolve it.
- **The live ruleset bypass actor** was conditional on the live ruleset
  having one. The live read (`gh api repos/corekraft/kore/rulesets/26788821`)
  shows one user actor with bypass mode `always`. The committed ruleset has
  none. The owner's list of 2026-11-20 does not name this item, so the retro
  reports it as found and leaves it to the main session to put to the owner.

## The six findings

Ranked by frequency times cost. The verdict from the grill is in each title.

## 1. Report merges past a failing precheck as a flow figure (changed: measurement only)

**Evidence.**

`harness judge merge` re-runs the precheck and records its verdict before it
merges (`runMerge`, `tools/harness/src/cli/judge-merge-commands.ts:107`). A
bare `gh pr merge` skips only that re-run, which is a harness convention. The
main session keeps `gh pr merge` on purpose: it has no role, and
`tools/harness/src/hook/guard-role-delivery.ts:4` leaves the command to it.
ADR 0109 notes that `--match-head-commit` still refuses a head nobody approved.

Counts:

- **ledger:** 131 PRs merged in the window. 102 of them had at least one
  `precheck` event.
- **ledger, upper bound:** 33 of the 102 merged with a failing last precheck
  verdict and no passing one after it.
  - Neither `precheck` nor `pr.merged` events carry a head, so the failing
    verdict cannot be matched to the merged head. 33 is an upper bound, not a
    count of merges past a failing precheck.
  - 23 of the 33 merged within 5 minutes of that verdict and 18 within 30
    seconds. #1395 merged 17 s after `feature-flagged:fail`, #1366 15 s after
    `feature-flagged:fail`.
- **ledger:** for 26 of the 33, the writer's last `pr.checked` event named
  `pattern-mismatch`, which is the enforce-mode `judge-pattern-match` gate.
  5 named none. 2 had no `pr.checked` event.
- **transcripts:** the main session `112bd8fe` ran 106 commands containing
  `gh pr merge` (65 with a pinned head) against 24 `judge merge` calls. The
  first two are at `112bd8fe:86943` and `112bd8fe:86989`.

**Cluster-facing recount.** 11 of the 33 declared `no-behaviour-change`. By
the precheck's own rule (`clusterFacing()` in
`tools/harness/src/judge/verdict.ts:16`), 3 of those 11 touched cluster-facing
paths (**gh**):

- #1298: charts and environment values
- #1269: the reference app's Dockerfile
- #1376: `infra/environments/schema.json`

AGENTS.md requires a live run before such a PR merges. The main checkout's
journal shows no `local up` between opening and merge for #1298 or #1269, and
#1376 merged after the last `local up` of 2026-11-19. A live run from another
checkout or from CI is not ruled out. This non-zero count is a finding in
itself: a merge past a failing precheck must never stand in for that live run,
or for flag-activation proof (ADR 0127).

**Live ruleset.** The live ruleset has a user bypass actor (see the owner
decisions above). So the first draft's claim that a bare merge bypasses no
protection holds only for the committed ruleset. Whether that bypass was used
for these merges was not checked.

**Proposed change.** One flow-report figure: merges past a failing precheck,
split by the failing gate. It is derived from the existing `precheck`,
`pr.checked` and `pr.merged` events, with no new event, tool, flag or guard.
Until those events carry a head, it is reported as an upper bound, with
unmatched heads counted as unknown. A second count covers the subset that
declared `no-behaviour-change` and touched cluster-facing paths, which should
be zero. The glossary entry for "merge past a failing precheck" goes in the
same PR. It lives in the flow domain. It is not filed as an idea: it goes as a
plain developer-tooling PR with `--idea none`.

**Hypothesis.** This path stays sanctioned, so the figure is a diagnostic, not
a target. As finding 2 lands, writers declare a matching pattern first, and
the `pattern-mismatch` share of the figure (26 of 33 today) falls.

**Metric.** `outcomes.reverts.rate`, as a guard only: merges past a failing
precheck must not start reverting. Window 30 days.

**Safety pattern.** no-behaviour-change (ADR 0099)

**Already filed.** None.

## 2. `pr check` lists the patterns that match the precheck (changed: narrowed to `pr check`)

**Evidence.**

The writer picks the `Safety pattern:` declaration by judgment. The precheck
then checks it against a fixed table, `MISMATCH[pattern](hints)` in `assess()`
(`tools/harness/src/judge/verdict.ts:60`), and gives the same verdict for the
same diff. Writers find a matching pattern by trial:

- **ledger, per PR:** 14 of 102 prechecked PRs switched their declared
  pattern between prechecks.
  - #1272 went from `no-behaviour-change` to `expand-contract`, then
    `branch-by-abstraction`, then back to `no-behaviour-change`, over six
    prechecks in three hours.
  - #1277 tried three patterns and was sent back for a body that contradicted
    its declaration.
  - #1261 tried three patterns in 39 seconds.
- **ledger, per event:** `pattern-mismatch` appears in 118 of 249 `pr.checked`
  events. That counts repeated checks of the same head, so the per-head
  baseline is
  `sendBackCategories.perPrHead.byCategory.pattern-mismatch`, not 118.

**Proposed change.** `harness pr check` runs `assess()` for every pattern
against the current head and lists those that match the precheck. The wording
is "matches the precheck", never "correct". Where several patterns match, the
writer still chooses.

The `pr open` warning from the first draft is dropped: no PR exists at
`pr open`, so there is no diff to read. A local `git diff <base>...HEAD`
version is deferred.

This is the one finding to file as an idea. Its window opens in sequence after
ideas 0010 and 0026 (ADR 0119), which move the same failures and have no
recorded outcome yet.

**Hypothesis.** If `pr check` names the patterns that match, writers declare
one of them before the judge sees the PR. Per-head pattern-mismatch failures
fall, and so do the merges past a failing precheck in finding 1.

**Metric.** `sendBackCategories.perPrHead.byCategory.pattern-mismatch`, down,
14 days. Read beside the per-PR switch rate (14 of 102 today). No target
number is set.

**Safety pattern.** no-behaviour-change

**Already filed.** Nearest are 0010 (writers run the precheck before done)
and 0026 (mechanical review checks in `pr check`). Neither lists the matching
patterns.

## 3. Measure signed sends after `signed-main-sends` (changed: guard dropped, measurement note)

**Evidence.**

AGENTS.md requires every agent message to carry a sender line written by a
harness command. Idea 0021 chose `session send` with wrapped-message
confirmation behind the `signed-main-sends` flag. ADR 0123 says ideas 0019 to
0021 add no guard rule, and ADR 0120 says the same of the bare-herdr gap.

The flag turned on in the local overlay at 2026-11-17T19:06:42-07:00
(2026-11-18T02:06:42Z, #1100), seven minutes before the window opened. So
every send in the window came after the flag:

- **scan:** 46 signed against 892 raw sends from the main session, plus 891
  pane reads and 1,525 poll minutes.
- **ledger:** 34 `session.send` events.

The all-history flow figures (8 signed, 1,491 raw) are mostly pre-flag
history and are not used here.

**Proposed change.** No code. A note on ideas 0021 and 0035: read
`mainSession.signedSendShare` for the window after the flag. With the flag on
for the whole window and raw sends still at about 95%, the gap is habit, not a
missing tool. The fix belongs in the main session's instructions or the spawn
brief, never a guard (owner decision 1).

**Hypothesis.** If the main-session instructions name `session send` as the
only way to message a role pane, the signed share rises above its post-flag
level of about 5%.

**Metric.** `mainSession.signedSendShare`, up, 14 days. This is the primary of
ideas 0021 and 0035, so it stays theirs and is not a new idea.

**Safety pattern.** no-behaviour-change

**Already filed.** Yes: 0021, 0030 and 0035. ADRs 0123 and 0120 rule out a
guard.

## 4. The scan stops counting the spawn brief as a correction (split: 4a now, 4b deferred)

**Evidence.**

- **scan:** 7 of the 17 repeated-correction clusters sit on line 7 of their
  sessions, which is the spawn brief. They include the four largest (13, 12,
  10 and 9 sessions): `236b0e80:7`, `a5f6bbcd:7`, `a237d642:7`.
- Two were checked. Both restate rules that `pr open` and
  `.claude/agents/writer.md` already enforce. The other five, and whether any
  of the seven is a real correction, are unverified.
- The scan's correction counter (`addPhrases`,
  `tools/harness/src/hook/retro-scan.ts:130`) does not skip the brief.

**Proposed change.**

- **4a, now.** `addPhrases` skips the spawn brief, as the scan already does
  for `bareCommands`. Measurement only, as a plain developer-tooling PR with
  `--idea none`. Its rerun is the baseline.
- **4b, deferred.** Render the brief's task line from the issue.
  - Today `session spawn --idea` only stamps the issue number, and `--brief`
    is required free text.
  - Rendering changes what a pane is told, so it is not
    `no-behaviour-change`.
  - It must not conflict with ADR 0121's small judgment brief.
  - Any warning about a restated rule stays a `session spawn` warning, never a
    guard.

**Hypothesis.** If the scan skips the brief, its correction list shows only
what was said after the brief. The line-7 count after 4a measures how many
briefs restate rules.

**Metric.** None in the flow report. 4a is measured by the scan's line-7
correction-cluster count. 4b would need its own primary, because
`metrics.tokensPerIdea` is shared (ADR 0119).

**Safety pattern.** no-behaviour-change (4a)

**Already filed.** Partly: 0014 (role panes get only the context their role
needs). It does not cover the scan.

## 5. Clip the scan to the window by line (split: 5a now, 5b held)

**Evidence.**

- **Not clipped by line.** `scan()` in `tools/harness/src/hook/retro-scan.ts`
  keeps a whole transcript once its last line falls in the window. The main
  session `112bd8fe` runs from 2026-11-12 to 2026-11-20 and is counted in full
  by every scan.
- **Runs out of memory.** `readTranscripts` loads every transcript before it
  applies the window, and ran out of heap at 4 GB this run.
- **Overlapping starts both count (ledger).** Two `retro.main-session` events
  from 2026-11-17 cover the same span from different starts, 07:00Z and
  12:52:40Z. ADR 0124 sums both by design: a window is its start.
- **Not a bug: the 2026-11-20 events.** The six `retro.main-session` events of
  2026-11-20 share one `windowStart`, and ADR 0124 counts them once. The flag
  being on in the local overlay is the owner's activation. ADR 0124's summary,
  "off in every overlay", is stale: a doc fix, not a finding.

**Proposed change.**

- **5a, now.** Filter lines by their own timestamp, and skip files last
  modified before the window starts. Scan-internal, no ledger change, as a
  plain developer-tooling PR with `--idea none`. This also fixes the heap
  failure.
- **5b, held.** Merge overlapping windows at report time, and record only
  under an explicit flag. Both change ADR 0124, so they wait on the refining
  ADR, which owner decision 3 holds until the 5a rerun shows the double count.
  The ledger is append-only, so any fix is a report-time rule.

**Hypothesis.** If the scan clips by line, two runs over one window give
identical figures, and the scan fits in the default heap.

**Metric.** Scan determinism (identical figures from two runs over one window)
is not a flow metric. The nearest flow figure is
`mainSession.foregroundPollMinutesPerMerged`, read after 5a. The double count
of the main session's poll minutes should leave it.

**Safety pattern.** no-behaviour-change (5a)

**Already filed.** None. 0012 and 0027 set up the figures, not their clipping.

## 6. Diagnose role blocks before any change (changed: diagnostic only)

**Evidence.**

- **ledger:** 240 `role-read-only` blocks, by role:

  | Role                                | Blocks |
  | ----------------------------------- | ------ |
  | judge                               | 112    |
  | main session's pane (no agent name) | 74     |
  | reader                              | 45     |
  | principles-review                   | 6      |
  | unrecorded                          | 3      |

  The 74 are why the scan counts fewer blocks than the ledger:
  240 − 74 = 166, within one of the scan's 167. This is not confirmed.

- **ledger:** 42 `role-worktree` blocks: 27 writer, 15 unrecorded.
- **scan:** 7 Write calls failed in roles without the tool. These are the
  clean wrong-role cases.

The role's `tools:` line cannot say which Bash commands `role-read-only`
blocks: every read-only role has Bash, and the blocks come from the regex
guard, which ADR 0091 calls a hint. Reading a free-text brief at spawn would
itself be a new guard, and the freeze rules that out (owner decision 1).

**Proposed change.** No code. A count table as a follow-up inside this doc:

1. Split the 240 and the 42 by command shape (read, write, merge, other).
2. Use `--evidence` verdicts to separate legitimate blocks from false
   positives.
3. Count a "wrong-role brief" only where the brief demanded a write or a
   merge.

The only code change in this area is the scratchpad-redirect quick fix the
owner allowed (owner decision 5).

**Hypothesis.** None. This finding is a diagnostic.

**Metric.** `guardBlocksByRule.role-read-only`, read only, no direction.

**Safety pattern.** None. No code.

**Already filed.** 0013, 0031 and 0033 own the wrongly-blocked-reads area.

## Filing

| Finding                                | How it goes                                                          |
| -------------------------------------- | -------------------------------------------------------------------- |
| 2 (`pr check` lists matching patterns) | The only idea, in sequence after 0010 and 0026                       |
| 1 (flow figure), 4a, 5a                | Plain developer-tooling PRs with `--idea none`                       |
| 3                                      | A note on ideas 0021 and 0035                                        |
| 6                                      | The follow-up table above                                            |
| 4b, 5b                                 | Deferred; 5b is held behind the ADR refining 0124 (owner decision 3) |

That is within the retro cap of 5 filed items.

## Judgment that should stay with agents

- **Whether a statement in a change is true.** 29 of the 39 send-backs in the
  window are `wrong-statement` (**ledger**), by far the largest category. They
  come from reading code against prose, which no table can decide.
- **Choosing among patterns that all match.** Finding 2 narrows the choice;
  `feature-flagged` against `dark-launched` still depends on intent. The
  pattern hints are heuristics, so the main session's sanctioned bare merge
  stays a human call, and finding 1 only measures it.
- **Judge verdicts.** In 4 labelled PRs (#1147, #1165, #1275 and #1280) one
  judge returned `blocked` and a later judge `done` (**ledger**). Events carry
  no head, so it cannot be said whether they judged the same input. That is
  too few to propose a change.
- **Repeated review runs.** 16 PRs had three or more `review.run` events
  (**ledger**). On #1351 the findings went 4, 1, 0, and on #1367 5, 0, 0,
  falling as fixes landed.

## No change proposed

- Writer model tiers vary between Haiku and Sonnet under an open randomized
  experiment. The Opus retro panes of 2026-11-20 were the owner's choice
  (owner decision 4).
- 13 commands refused by the old system bash (**scan**) are friction, not a
  determinism problem.
- The scan's proposal to remove the `judgment` agent is a false positive: the
  tick starts it from code (`tools/harness/src/orchestrator/idea-run.ts`), and
  the scan counts only pane launches.

## Overall read

Most of what should be deterministic here is already code:

- the precheck's pattern table
- the sender-line writer
- the role tool lists
- the scan

Most of the inconsistency comes from agents not seeing that code's answer in
time. Writers guess the safety pattern and learn the precheck's answer one
failure at a time. The main session merges past failing prechecks on a path
the owner sanctioned, and nothing measures how often. The scan's own figures
depend on when it runs.

The smallest fixes are reads, not new gates:

- `pr check` shows every pattern the table accepts.
- A flow figure counts merges past a failing precheck, with its cluster-facing
  subset, which must stay at zero.
- The scan clips by line and stops counting briefs as corrections.

Guards stay frozen. Where agents keep doing something by hand after a tool
exists, as with raw sends after `signed-main-sends`, the remedy is
instructions, not enforcement. What stays with agents is narrow: whether prose
is true, which of several matching patterns fits the intent, and whether a
merge past a failing precheck is warranted.
