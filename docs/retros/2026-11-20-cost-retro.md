---
summary: Cost and token retro over the sessions from 2026-11-18T02:13Z to 2026-11-20; where the 2.1 billion tokens and 343 dollars went, and six savings with their arithmetic, quality risk and metric; none applied.
date: 2026-11-20
last-verified: 2026-11-20
---

# Cost Retro 2026-11-20

This retro is one of several independent retro writers for the window since the
last retrospective (2026-11-18T02:13:52Z) up to 2026-11-20 about 09:00Z, about
2.3 days. Its lens is cost and token economics. These findings are proposals;
none is applied, and no idea is filed from here.

## Method and sources

- **Transcripts.** Every transcript in the main checkout and the worktree
  folders with a request in the window: 261 top-level sessions and 134
  subagent transcripts, 15,424 API requests, deduplicated by message and
  request id. Each request is priced with the repository's own table,
  `tools/harness/src/flow/writer-prices.ts` (read 2026-11-17), including the
  Haiku price step above 100k prompt tokens.
- **Roles.** A worktree is mapped to its role through `.kore/state/sessions/`.
  A closed pane's record is gone, so 41 worktree sessions have no record; by
  their names almost all are writers.
- **Precomputed reports.** `/tmp/kore-retro-2026-11-20/flow-report.json` (all
  history, trailing 7 days for the per-merged figures) and `retro-scan.json`
  (window only).
- **Ledger.** `.kore/state/ledger.jsonl` events in the window: 205
  `session.launch`, 204 `spawn.unstamped`, 303 `guard.block`, 135 `pr.merged`.
- **The retro skill**, run with this lens as a background fork. It returned
  seven proposals; the strongest are below, with their figures checked and
  corrected against the window. The rest are listed after the findings with
  why they were not kept.

Citations are `session-id-prefix:line` in the transcript, or a ledger event
kind. No transcript text is quoted.

## Where the money and tokens went

| Bucket (window)                          | Sessions | Dollars |    Tokens | Share of dollars |
| ---------------------------------------- | -------: | ------: | --------: | ---------------: |
| Main checkout, top level                 |      138 |  171.40 |      955M |              50% |
| of which orchestrator `112bd8fe`         |        1 |   93.71 |      707M |              27% |
| of which Haiku judges                    |       99 |    3.24 |       60M |               1% |
| Writer worktrees (recorded and not)      |      122 |  151.58 |     1110M |              44% |
| Main-session subagents                   |      130 |   15.25 |       34M |               4% |
| Writer subagents (the retro skill forks) |        5 |    5.03 |        8M |               1% |
| **All**                                  |  **395** | **343** | **2108M** |         **100%** |

- 98% of all tokens are cache reads of a session's own context, so cost scales
  with **context size times request count**, not with how much work a request
  does.
- Per merged change, the window's spend comes to $343 / 135 merged PRs = $2.54
  and 2108M / 135 = 15.6M tokens. The flow report's trailing 7 days agree in
  shape: orchestrate 149,885 and write 116,349 tokens per merged change, and
  review only 567, because principles-review runs as a main-session subagent
  and its tokens fall in the orchestrate stage.
- By model, Sonnet is $216 (63%), Opus $77 (22%) and Haiku $50 (15%). The Opus
  part is one owner-facing main session (`5dfa430d`, $39), a browser session
  (`966a971c`, $13), and the retro writers themselves (5 sessions and their
  forks, $18).
- By tier, in the window's surviving session records, writers launched 44 times
  on Sonnet at high effort, 28 on Haiku at high, 5 on Opus at high (the retro
  writers) and once on Sonnet at medium. All 99 judges launched on Haiku at high
  effort. `writer.md` and `judge.md` both say Haiku at medium.

**Spend that ships nothing.** The findings overlap, so their figures are not a
sum. Removing the overlap roughly: context carried above a 120k cap in the main
sessions ($41), the Haiku price-step premium ($34), polling and repeated state
reads (about $11 at today's context size) and guard-block retries (about $11)
come to roughly $95, **about 28% of the window**. Abandoned work is small: the
worktrees with no PR cost about $7.5 in the window, mostly grilling panes that
were never meant to open one.

## Findings, most costly first

### 1. Cap the main session's context and hand over at the cap

- **Evidence.** The orchestrator `112bd8fe` made 2,871 requests in the window
  at an average prompt of 246,158 tokens. 2,520 of them were above 120k, and
  carried 367.8M tokens above that line. Its first request over 120k is at
  `112bd8fe:86886`, and its largest prompt, 479,979 tokens, at
  `112bd8fe:100124`. The Opus main session `5dfa430d` had 337 of 520 requests
  above 120k, 22.8M tokens over the line (first at `5dfa430d:3672`, largest at
  `5dfa430d:6602`). `mainSessionSetups.compactionCap` is `null`, and every
  stretch is labelled `not set`. The session `112bd8fe` has run since
  2026-11-12, so this pattern is long-standing.
- **Proposed change.** Set `cost.compactionCap` (120,000) in
  `.claude/harness.json`. The main session reads `harness session prompt-size`
  after each wave and runs the `handoff` skill, then compacts, when it is over
  the cap. This is the E2 arm that idea 0038 names "filed after E3".
- **Savings over the window.** At most the 390.6M tokens above the cap
  (367.8M + 22.8M). A tighter cap means more compactions. The two sessions
  wrote 5.06M new tokens to cache in the window (3.16M + 1.90M). At about 90k
  of growth per stretch (from a 30k summary up to the 120k cap), that is about
  56 compactions instead of today's 19, so 37 more at about 150k tokens each
  (a 120k read and a 30k rewrite), or 5.6M tokens. The net saving is about
  **385M tokens**: $36.78 plus $4.55 at the cache-read prices, less 37
  compactions at about $0.19 each, so about **$34**. That is 49% of the two
  sessions' 787M prompt tokens.
- **Quality risk.** A compaction drops in-flight state, such as which pane
  serves which PR or a decision not yet written down. That shows up as wrong
  merges, repeated reads and repeated owner questions.
- **Hypothesis.** If the main session hands over at a 120k cap, its tokens per
  merged change fall by about half, while send-backs and owner questions per
  merged change hold.
- **Metric.** `tokensByStagePerMergedChange.current` (orchestrate), down,
  14 days. Guards: `sendBacksPerMergedChange.current` and
  `ownerQuestions`.
- **Safety pattern.** `no-behaviour-change`
- **Already filed.** None. Idea 0038 names this as E2 but does not file it.

### 2. Keep Haiku writers under the 100k price step

- **Evidence.** 47 Haiku worktree sessions made 4,591 requests in the window.
  3,233 of them (70%) had a prompt above 100k, carrying 626.0M prompt tokens,
  302.7M of them above the line. Above 100k, Haiku pays five times its base
  rate on the whole request, cache hits included. Those requests cost $42.97;
  at the base step they would cost $8.59. That is a **$34.38 premium, 75% of
  all Haiku worktree dollars** ($45.7). Examples: `3071a1af`
  (database-certs-local-ca), 282 of its 307 requests over 100k, first at
  `3071a1af:338`, peaking at 465,568 tokens at `3071a1af:3614`; `798ba953`
  (loopback-443-cutover), 193 of 219, first at `798ba953:216`; and `8c345187`
  (tier-cost-report), first at `8c345187:291`. The flow report gives Haiku
  `over100kShare` 0.66 against Sonnet's 0.42. This is new since writers moved
  to Haiku (2026-11-17 to 19).
- **Why Haiku contexts grow.** Per writer session, Haiku writes 110,676 output
  tokens against Sonnet's 65,798, and makes 116 requests against 91, while its
  tool results are about the same (about 48k tokens against 51k). Its largest
  prompt averages 222k against 175k. So most of the growth is Haiku's own
  output, and all 28 Haiku writers ran at high effort, not the medium that
  `writer.md` sets.
- **Proposed change.** `session spawn` sets a 95k compaction threshold for a
  Haiku pane, and the writer brief has it read `session prompt-size` before
  each commit. This is idea 0038's E1 arm. Also launch Haiku writers at the
  definition's medium effort, which cuts the output that fills the context.
- **Savings over the window.** At most the 302.7M tokens above the step.
  Compacting at 95k down to about 25k costs about 2.8 compactions per session
  ((222k − 25k) / 70k). Over 47 sessions that is about 130 compactions at about
  120k tokens each, or 15.6M tokens. The net saving is about **287M tokens**,
  and dollars fall from the $34.38 premium to about **$31** once the
  compactions are paid.
- **Quality risk.** Haiku is already blocked more often: `writerArms.overall`
  shows a blocked share of 0.33 against Sonnet's 0.10, and 0.6 send-backs per
  merged change against 0.31. A compaction in the middle of a red-green loop
  could raise both.
- **Hypothesis.** If a Haiku writer compacts before 100k, Haiku's all-in cost
  per merged change falls by about two-thirds, while its blocked share and
  send-backs hold.
- **Metric.** `writerCost.current`, down, 14 days. Guard:
  `sendBacksPerMergedChange.current`.
- **Safety pattern.** `feature-flagged`
- **Already filed.** None. Idea 0038 names this as E1 but does not file it.

### 3. Replace the main session's remaining polls with `harness wait` and one PR read

- **Evidence.** In `112bd8fe`, 678 requests (167.0M tokens, 23.6% of its prompt
  tokens) only polled:
  - 166 sleep or `until` loops, first at `112bd8fe:87151`;
  - 160 status reads;
  - 152 CI check reads, first at `112bd8fe:88451`;
  - 105 Monitor reads;
  - 95 pane reads, first at `112bd8fe:86943`.

  Another 255 requests (63.2M) read PR fields one per call: the head SHA (46),
  the review decision with or without the merge state (38), the body (16) and
  the comments (10). `harness wait` is already in use (211 requests), so the
  polling runs beside it rather than instead of it. The scan reports 1,525
  minutes of main-session polling, 891 pane reads and 890 raw sends against 44
  signed sends in the window. `finishDetection.neverNoticed` is 308 of 552
  results. Polling is long-standing: ideas 0019, 0035 and 0038 date from
  2026-11-14 to 18.

- **Proposed change.** In the brief that `harness hook context` gives a fresh
  main session: wait only with `harness wait --pr` or `--session` in the
  background, never `sleep`, an `until` loop or a pane read. Add a read-only
  `harness pr status <pr> --json` that returns the head SHA, review decision,
  merge state and checks in one call, in place of field-by-field `gh pr view`
  calls. `pr check` mutates, so it is not that read.
- **Savings over the window.** The sleep loops, CI polls and pane reads come to
  413 requests and 99.6M tokens. If one wait in four remains, the saving is
  0.75 × 99.6M = 75M tokens. Halving the 255 field reads saves 31.6M. The total
  is about **106M tokens (about $10.6)** at today's context size, and about
  half that once finding 1 caps the context.
- **Quality risk.** A wait that never wakes leaves a pane idle, which is what
  `finishDetection.neverNoticed` already counts.
- **Hypothesis.** If the main session waits only through `harness wait`, its
  poll minutes per merged change fall, while lead time per merged change holds.
- **Metric.** `mainSession.foregroundPollMinutesPerMerged`, down, 14 days.
  Guard: `leadTimePerMergedChange.current`.
- **Safety pattern.** `dark-launched`. The new read-only command ships unused
  until the brief names it.
- **Already filed.** 0019, 0035 and 0038 cover polling. The field-by-field PR
  reads are not covered.

### 4. Stop paying for guard blocks on read-only work

- **Evidence.** 303 `guard.block` events in the window: `role-read-only` 240,
  `role-worktree` 49, `role-no-merge` 8. Each block costs the refused request
  and then a retry, both at the session's average prompt (116k for the
  read-only blocks). The retro scan's sample found 2 of its 3 `role-read-only`
  blocks were plain read commands: a `for` loop, and a command ending in a
  stderr redirect. This session hit the same pattern four times: a regex inside
  `node -e` read as a path, a write to its own scratchpad, a read under the
  home transcripts folder, and the bash 3.2 refusal. All four were reads or
  scratch writes.
- **Proposed change.** In `tools/harness/src/hook/guard-role-allow.ts`, accept
  file-descriptor redirects such as `2>&1` and `for` loops whose body is only
  read-only commands. Let `role-worktree` allow reads, not writes, of the
  transcript and session-state folders that retro roles are briefed to read.
- **Savings over the window.** One round at the session average is 35.7M
  tokens for the 303 blocks, so a block and its retry come to 2 × 35.7M =
  71.4M tokens (about $11.3). If half the read-only blocks are false
  positives, as the sample suggests, the saving is about **28M tokens (about
  $4)**.
- **Quality risk.** A looser allowlist can let a mutating command through.
  The guard corpus in `tools/harness/integration/hook/guard-corpus.spec.ts` and
  `harness guardrail replay` are the check.
- **Hypothesis.** If the read-only guard accepts redirects and read-only
  loops, `role-read-only` blocks fall by about half and no mutating command
  gets through.
- **Metric.** `guardBlocksByRule.role-read-only`, down, 14 days.
- **Safety pattern.** `feature-flagged`. Loosening an enforced guard needs the
  owner's approval (ADR 0080).
- **Already filed.** 0011 (guard blocks on legitimate work).

### 5. Launch writers at their definition's tier unless escalated

- **Evidence.** In the window, 50 of 78 writer launches were overrides (ledger
  `session.launch` with `tierSource: override`) and 28 used the definition.
  44 ran on Sonnet, although `writer.md` says Haiku.
  `writerArms.excluded.notRandomized` is 16, so the overrides also thin out the
  randomized window of idea 0040. Window cost per writer session: Sonnet $1.34
  (46 sessions, $61.70, 5.0M tokens each), Haiku $0.92 (30 sessions, $27.72,
  14.4M tokens each). In the flow report the all-in cost per merged change is
  $3.20 for Sonnet and $2.30 for Haiku, and `writerArms.overall` puts the
  difference at −$0.55 with an interval of −$1.11 to −$0.02.
- **Proposed change.** The main session names no `--model` for a writer unless
  `queue escalate` recorded an escalation for that PR, as the `session spawn`
  help already says while the window is open. This is a line in the main
  session's brief.
- **Savings over the window.** 44 × ($1.34 − $0.92) = **$18.5**. Tokens go
  **up**, by 44 × (14.4M − 5.0M) = 414M, because Haiku runs larger contexts.
  Do finding 2 first: with Haiku under the step, the per-session gap widens by
  about $0.73 ($34.38 over 47 sessions).
- **Quality risk.** Haiku's blocked share is 0.33 against 0.10, and its
  send-backs 0.6 against 0.31 per merged change.
- **Hypothesis.** If writers launch on Haiku unless escalated, all-in cost per
  merged change falls, while send-backs per merged change stay under the
  window's margin.
- **Metric.** `writerCost.current`, down, 14 days. Guard:
  `rework.sendBacksPerIdea`.
- **Safety pattern.** `no-behaviour-change`
- **Already filed.** 0040 (the writer tier window).

### 6. Stamp every spawn with its idea, so cost can be measured at all

- **Evidence.** None of the 205 `session.launch` events in the window carry an
  idea. 204 `spawn.unstamped` events were recorded, none with a `--no-idea`
  reason (99 judges, 77 writers, 14 readers, 14 principles-review). As a
  result:
  - in the flow report, `writerCost.current.unjoinable` is 480 of 560 merged
    changes;
  - `metrics.tokensPerIdea` reads "insufficient history" (2 of the 6 closed
    ideas it needs);
  - every `costWaiting.ideas` entry shows 0 dollars.

  So the metric that a model-tier idea must use as its hypothesis cannot be
  read, and neither can any per-idea saving above.

- **Proposed change.** `session spawn` refuses a writer, judge or
  principles-review spawn that names neither `--idea` nor `--no-idea`. Today
  it warns and starts. Put the refusal behind a flag, in audit first.
- **Savings over the window.** No tokens directly. It is the precondition for
  measuring findings 1 to 5 per idea instead of per window.
- **Quality risk.** A refused spawn delays a writer. The `--no-idea <reason>`
  escape keeps that delay to one retry.
- **Hypothesis.** If spawn refuses unstamped role panes, unstamped spawns fall
  to near zero and `metrics.tokensPerIdea` becomes readable within 14 days.
- **Metric.** `unstampedSpawns.total`, down, 14 days.
- **Safety pattern.** `feature-flagged`
- **Already filed.** 0012 (stamp every loop event with its idea and stage).

## Retro skill proposals not kept as findings

- **principles-review is costly.** The skill counted 618 calls over all
  history and guessed a large hidden cost. In the window it ran 90 times for
  $9.37 and 12.1M tokens, $0.10 a review: 2.7% of the window, and cheaper than
  any change that keeps the review. Not kept.
- **The retro scan runs out of memory** at node's default heap. That is wall
  time and memory, not tokens, and belongs to the determinism lens.
- **Remove the unused `add-policy` skill and `judgment` agent.** Fewer skill
  descriptions save about 60 tokens a request, or about 0.9M tokens over
  15,424 requests. That is too small to rank.

## Overall read

The delivery loop's cost is driven by context size, not by work done. 98% of
the 2.1 billion tokens in the window are cache reads, so a request costs what
its session already holds. The two levers that matter most are both
compaction caps that the harness already measures but has not set: the main
session carries an average of 246k tokens through 2,871 requests, and Haiku
writers pay a five-times rate on 70% of their requests. Together they come to
about 670M tokens and $65 over 2.3 days, about a fifth of all spend, and the
early-compaction and Haiku-under-the-cap arms were planned in idea 0038 but
never filed. Polling, field-by-field PR reads and guard retries are each
smaller, and all are already filed. Model choice matters less than it looks:
Haiku writers are cheaper per merged change only because they run on a cheap
model while using about three times Sonnet's tokens, and that edge grows a lot
once they stay under the step. Judges and principles-review are cheap and
should be left alone. The largest blind spot is measurement: no spawn in the
window carried an idea stamp, so per-idea cost cannot be read. Each saving
above can be tested only as a window ratio until finding 6 lands.
