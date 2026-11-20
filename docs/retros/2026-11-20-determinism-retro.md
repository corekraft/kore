---
summary: Determinism retro over about 250 sessions from 2026-11-18T02:13:52Z to 2026-11-20. Six findings, each a decision agents now make by hand or around code that already decides it. Proposals only; none filed or applied.
date: 2026-11-20
last-verified: 2026-11-20
---

# Determinism Retro 2026-11-20

This retro asks one question: what do agents decide by judgment, or by hand,
where the same input should always give the same answer, and where a wrong or
inconsistent answer is costly? It also covers the opposite cases. Some code
already decides deterministically and agents work around it. Some decisions
need real judgment and should stay with agents.

The window runs from the last retrospective, 2026-11-18T02:13:52Z, until
2026-11-20T08:35Z. In that window:

- 38,781 ledger events
- 190 spawned panes recorded in `.kore/state/sessions/`
- 253 transcripts touched (134 in the main checkout folder, the rest in
  worktree folders)

The retro scan (`hook retro-scan --strict`) counted 250 sessions. Its first run
ran out of heap at 4 GB (`/tmp/kore-retro-2026-11-20/retro-scan.err`). The rerun
had no `--evidence`, so guard blocks have counts but no verdicts. Findings 3
to 6 come from that scan, read for this topic and checked against the ledger.
Findings 1 and 2 come from the ledger alone.

Evidence is cited as ledger event kinds with PR numbers, or as
`session-id:line` in the transcripts. No transcript text is quoted.

Findings are ranked by frequency times cost, most costly first.

## The six findings

## 1. Merge through `judge merge` with a recorded waiver, never a bare `gh pr merge`

**Evidence.** The code already decides this case, and agents work around it.
`harness judge merge` re-runs the precheck and records its verdict at the
ledger before it merges (`tools/harness/src/cli/judge-merge-commands.ts:107`).
So a PR merged through it always has a passing `precheck` event before its
`pr.merged`. In the window:

- 131 PRs merged; 102 of them had at least one `precheck` event.
- 33 of those 102 merged with a failing last `precheck` verdict and no pass
  after it.
- 23 of the 33 merged within 5 minutes of that failure, and 18 within 30
  seconds. #1395 merged 17 s after `feature-flagged:fail`; #1366 merged 15 s
  after `feature-flagged:fail`.
- For 26 of the 33, the writer's last `pr.checked` event named
  `pattern-mismatch`. That is the enforce-mode `judge-pattern-match` gate in
  `.claude/guardrails.yaml`.
- The main session `112bd8fe` ran 106 commands containing `gh pr merge` in the window (65
  with a pinned head) against 24 `judge merge` calls. The first two are at
  `112bd8fe:86943` (#1081) and `112bd8fe:86989` (#1102).

The memory note on owner time over gates allows this by design: a low-risk
change stuck on a pattern mismatch merges with a pinned head. The bypass is
legitimate, but it leaves no record. Nothing tells a matcher false positive
apart from a wrong declaration, so the matcher never improves.

**Proposed change.** Add `--waive <gate> --reason <category>` to
`harness judge merge`. It still pins the head and merges only when every other
gate passes, and it records one `judge.waived` ledger event naming the gate,
the reason category and the PR. Add an audit-mode guard rule that warns when
the main session runs a bare `gh pr merge`, pointing at `judge merge --waive`.
Both live in the harness: the judge domain and `hook guard`.

**Hypothesis.** If waivers go through `judge merge` and are recorded, bare
merges after a failing precheck fall from 33 of 102 to near zero. The recorded
waiver reasons then show which pattern-match hints are false positives, so
they can be fixed.

**Metric.** `outcomes.reverts.rate`, down, 30 days, as the safety guard that
waived merges do not start reverting. The direct count of waivers needs a new
`judge.waived` figure in the flow report.

**Safety pattern.** feature-flagged

**Already filed.** None. Idea 0010 has writers run the precheck. It does not
cover the merge side.

## 2. Compute the safety pattern from the diff instead of guessing it

**Evidence.** The writer picks the `Safety pattern:` declaration by judgment.
The precheck then checks it against a fixed table: `MISMATCH[pattern](hints)`
in `assess()`, `tools/harness/src/judge/verdict.ts:60`. The same diff always
gets the same verdict, but writers find the matching pattern by trial and
error:

- 14 of the 102 prechecked PRs switched their declared pattern between
  prechecks.
- #1272 went from `no-behaviour-change` to `expand-contract`, then
  `branch-by-abstraction`, then back to `no-behaviour-change`: six prechecks
  over three hours.
- #1277 tried three patterns, passed once on `branch-by-abstraction`, switched
  back to `expand-contract`, and got a send-back for a body that contradicted
  the declared pattern.
- #1261 tried three patterns in 39 seconds.
- `pattern-mismatch` was the most common failure a writer owned: 118 of the
  249 `pr.checked` events in the window. The next, `failed-check`, had 9.

Agents disagree with each other and with themselves on the same diff, and the
table they are guessing at is already in code.

**Proposed change.** `harness pr open` and `harness pr check` run `assess()`
for every pattern against the branch's diff and print the patterns that match.
`pr open` warns when `--pattern` is not among them, in audit mode first. Only
judgment-only patterns (for example `feature-flagged` against `dark-launched`)
are left for the writer to choose.

**Hypothesis.** If `pr open` names the matching patterns before the PR exists,
writers declare a matching pattern first time. Pattern switches fall from 14
of 102 PRs to under 3, and `pattern-mismatch` stops being the top `pr check`
failure.

**Metric.** `sendBackCategories.perPrHead.byCategory.pattern-mismatch`, down,
14 days.

**Safety pattern.** dark-launched

**Already filed.** Partly: 0010 (writers run the precheck before done) and
0026 (mechanical review checks in `pr check`). Neither computes the pattern.

## 3. Route every main-session pane message through `session send`

**Evidence.** AGENTS.md requires every agent message to carry a sender line
written by a harness command. `harness session send` writes that line
deterministically. A raw `herdr agent prompt`, `pane send-text` or `send-keys`
writes it only if the agent remembers. The figures:

| Source                               | Signed sends | Raw sends | Other                                        |
| ------------------------------------ | ------------ | --------- | -------------------------------------------- |
| Retro scan, window, 48 main sessions | 46           | 892       | 891 pane reads, 1,525 poll minutes           |
| Flow report, all history             | 8            | 1,491     | share 0.0053 (`mainSession.signedSendShare`) |

The ledger has 34 `session.send` events in the window against 195 launched
sessions.

**Proposed change.** Add an audit-mode guard rule for the main session. It
warns on raw `herdr agent prompt`, `pane send-text` and `send-keys` to a role
pane, and names `harness session send` and `session wait`. It lives in
`hook guard`.

**Hypothesis.** If raw sends warn, the main session switches to
`session send`, and the signed share rises from about 5% to over 50%.

**Metric.** `mainSession.signedSendShare.share`, up, 14 days.

**Safety pattern.** dark-launched

**Already filed.** Yes: 0021, 0030 (live verification) and 0035 cover the
routing and the polling. The window shows they have not moved the figure yet.
That makes this a follow-up on those ideas, not a new one.

## 4. Render spawn briefs from the issue and the role, not by hand

**Evidence.** The main session writes each spawn brief by hand, so the same
role and issue get differently worded rules. 7 of the scan's 17
repeated-correction clusters sit on line 7 of their sessions, which is the
spawn brief. They include the four largest clusters (13, 12, 10 and 9
sessions): `236b0e80:7`, `a5f6bbcd:7`, `a237d642:7`. Two that were checked
restate rules that `pr open` and `.claude/agents/writer.md` already enforce:
`Refs` not `Closes`, the `Safety pattern:` line, test first, flag off.
Restating a rule by hand can drift from the code that enforces it. Because the
scan's correction counter (`addPhrases`) does not skip the brief, it also
reports the briefs as user corrections.

**Proposed change.**

1. `session spawn --idea N` renders the task line from the issue, and warns
   when a free-text brief restates a rule the role definition already carries.
   This lives in the session domain.
2. The retro scan leaves the spawn brief out of corrections, as it already
   does for `bareCommands`.

**Hypothesis.** If briefs are rendered from the issue and the role, the
standing rules come from one place, and briefs shrink. The correction clusters
on line 7 go to zero, and so does the token cost of the restated rules.

**Metric.** `metrics.tokensPerIdea`, down, 14 days. It is a shared guard
metric (ADR 0119), so the qualifier will warn. Read it with the line-7 cluster
count from the scan.

**Safety pattern.** branch-by-abstraction

**Already filed.** Partly: 0014 gives role panes only the context their role
needs. It does not render the brief.

## 5. Make the retro scan's figures depend on the window alone

**Evidence.** The same window gives different figures depending on when and
from where the scan runs:

- **Window not clipped.** `scan()` in `tools/harness/src/hook/retro-scan.ts`
  keeps a whole transcript once its last line falls in the window. The main
  session `112bd8fe` runs from 11-12 to 11-20 and is counted in full by every
  scan.
- **Overlaps summed twice.** `scansIn` in `tools/harness/src/flow/main-session.ts`
  merges only events with the same start. The two 11-17 `retro.main-session`
  events cover the same span from different starts, 07:00Z and 12:52:40Z, and
  both are summed (about 1,340 poll minutes each).
- **Writes from read-only sessions.** With the `main-session-figures` flag on
  in the local overlay, every scan appends to the main ledger. Six
  `retro.main-session` events with the same `windowStart` were recorded
  between 08:20Z and 08:35Z today, all from retro panes.
- **Runs out of memory.** `readTranscripts` loads every transcript before it
  applies the window, and ran out of heap at 4 GB.

**Proposed change.**

1. Filter lines by their own timestamp, not by the session's last line.
2. Merge overlapping windows in `scansIn`.
3. Skip files last modified before the window starts.
4. Record a ledger event only under an explicit `--record` that the main
   session passes.

All four are in the hook and flow domains.

**Hypothesis.** If the scan clips by line and records only on request, two
runs over the same window give the same figures. The main-session poll minutes
stop double counting and fall to their true value.

**Metric.** `mainSession.foregroundPollMinutesPerMerged.perMerged`, down, 14
days. The fall is the double count going away.

**Safety pattern.** dark-launched

**Already filed.** None. 0012 and 0027 set up the figures, not their
clipping.

## 6. Refuse a spawn whose brief needs tools the role lacks

**Evidence.** Whether a role can run a command is decided by its agent
frontmatter and the role guards, so it is known before the pane starts. Agents
learn it by trying:

- `role-read-only` blocked 240 times in the window (ledger `guard.block`;
  the scan counted 167 in the sessions it read). The first was
  `0d9daa61` (a judge) at 2026-11-18T02:16:25Z.
- `role-worktree` blocked 42 times.
- Write tool calls failed 7 times in roles that do not have the tool.
- A retro run launched for this doc in a read-only fork was asked to write
  the doc and could not.

Some blocks are legitimate. Without `--evidence` verdicts the false-positive
share is unknown.

**Proposed change.** `harness session spawn` reads the role's `tools:` line
and the skills the brief names, and refuses a spawn whose brief asks for a
write, an edit or a merge the role cannot do, naming the role that can. This
lives in the session domain.

**Hypothesis.** If a mismatched brief is refused at spawn, read-only blocks
caused by a wrong brief disappear, and `role-read-only` blocks fall by at
least a third.

**Metric.** `guardBlocksByRule.role-read-only`, down, 14 days.

**Safety pattern.** feature-flagged

**Already filed.** Partly: 0013 (judge reads) and 0031 (reader reads) widen
what read-only roles may run. Neither checks the brief against the role.

## Judgment that should stay with agents

- **Whether a statement in a change is true.** 29 of the 39 send-backs in the
  window are `wrong-statement`, the largest category by far. They come from
  reading code against prose, a decision no table can make. Finding 4
  removes only restated standing rules, not this review.
- **Choosing among patterns that all match.** Finding 2 narrows the choice;
  `feature-flagged` against `dark-launched` still depends on intent. The
  pattern hints are heuristics, so finding 1 keeps a waiver and records it
  rather than making the matcher final.
- **Judge verdicts.** In 4 labelled PRs (#1147, #1165, #1275 and #1280) one
  judge returned `blocked` and a later judge `done`. This retro did not check
  whether the head changed in between, so it cannot say the judges disagreed
  on the same input. That is too few to propose a change.
- **Repeated review runs.** 16 PRs had three or more `review.run` events. On
  #1351 the findings went 4, 1, 0 and on #1367 5, 0, 0, falling as fixes
  landed. That is review doing its job, not noise.

## No change proposed

- Writer model tiers vary (Haiku and Sonnet) by an open randomized
  experiment, not by drift. The Opus panes in the window are only the retro
  panes of 2026-11-20, which this run's brief chose.
- 13 commands refused by the old system bash are friction, not a determinism
  problem.
- The scan's proposal to remove the `judgment` agent is a false positive: the
  tick starts it from code (`tools/harness/src/orchestrator/idea-run.ts`), and
  the scan counts only pane launches.

## Overall read

Determinism in this repo is mostly already written. The precheck table, the
sender-line writer, the role tool lists and the guard rules all give the same
answer for the same input. The costly inconsistency sits where agents either
guess ahead of that code or step around it. Writers guess the safety pattern
and correct it through the precheck, one pattern at a time. The main session
merges a third of prechecked PRs past a failing gate, and sends nearly every
pane message raw. Briefs restate rules by hand, and the scan that measures all
this gives different figures for the same window. The smallest fix in each
case runs the existing deterministic code earlier, in `pr open` or
`session spawn`. Where a human override is right, it should go through the
tool and leave a record, not bypass it. What should stay with agents is narrow
and easy to see: whether prose is true, which of several matching patterns
fits the intent, and whether a waiver is warranted.
