---
summary: Cost and token retro over 2026-11-18T02:13Z to 2026-11-20T09:00Z (2.1 billion tokens, $343, 33.1 billion plan-weighted); two measured context-cap cases for idea 0038's E2 and E1, queued after E3, one brief line for PR reads, and notes on ideas 0012, 0019, 0031, 0033 and 0040; owner decisions recorded; none applied.
date: 2026-11-20
last-verified: 2026-11-20
---

# Cost Retro 2026-11-20

This retro is one of several independent retro writers for the window since the
last retrospective, from 2026-11-18T02:13:52Z to 2026-11-20T09:00Z (the last
transcript activity read is 08:59:34Z), about 2.3 days. Its lens is cost and
token economics. It was grilled (retro-cost-griller and retro-cost-answerer),
and the owner decided the open questions on 2026-11-20. Nothing here is
applied, and no idea is filed from here; any idea named for filing goes
through the owner under ADR 0120.

## Sources and labels

Every count carries its source in brackets:

- **[transcripts]**: every transcript in the main checkout and worktree folders
  with a request in the window. That is 260 top-level sessions and 135
  subagent transcripts (395), and 15,424 API requests, deduplicated by message
  and request id. Each request is priced from
  `tools/harness/src/flow/writer-prices.ts` (read 2026-11-17), including the
  Haiku price step: above 100k prompt tokens, a Haiku request pays five times
  the rate on the whole request (`PROMPT_STEP_TOKENS`).
- **[plan-weighted]**: the same tokens weighted as
  `tools/harness/src/flow/plan-tokens.ts` does: each model's input price over
  Haiku's. That gives Haiku 1 (5 above the step), Sonnet 20, Opus 40. The
  constraint is plan-weighted tokens; dollars are a readability aid, and raw
  tokens come third. `weeklyTokenCeiling` is not set in `.claude/harness.json`,
  so a share of one week's ceiling is "not set".
- **[ledger]**: `.kore/state/ledger.jsonl` events inside the window.
- **[flow report]**: `/tmp/kore-retro-2026-11-20/flow-report.json`, all
  history; its per-merged figures cover the trailing 7 days.
- **[retro scan]**: `/tmp/kore-retro-2026-11-20/retro-scan.json`, window only.
- **[session records]**: `.kore/state/sessions/`. A closed pane's record is
  gone, so 41 worktree sessions have none; by their names most are writers.
- **[gh]**: `gh pr list` on `corekraft/kore`.
- **[code]**: a grep of `tools/harness/src`.

Citations are `session-id-prefix:line` in a transcript, or a ledger event kind.
No transcript text is quoted.

## Owner decisions (2026-11-20)

The owner decided every open question from the grills. The ones that bear on
this doc:

1. **The guard freeze stays** (ADRs 0091, 0101, 0123). No new guard rule,
   including in audit mode.
2. **The orchestrator tick should run.** No finding here waits on it.
3. **Context caps: as recommended.** E2 and E1 are not moved ahead of E3 on the
   dollar case. They are presented as filed in sequence after E3, and the owner
   sets the cap value after the baseline.
4. **No `--override` or `--accept` on `judge merge`** inside this retro.
5. **Read-only guard: no loop or substitution parsing.** Only the
   scratchpad-redirect quick fix to the existing rule.
6. **Opus for the 2026-11-20 retro writers** was a special case the owner
   chose. It is not an issue, and no saving is proposed for it.
7. **Judge effort** (medium or high) goes to the decider with data. The ADR
   refining 0124 is held until the 5a rerun shows the double count. `review
post --none` refusing when no review is recorded for the head is accepted as
   a non-guard tool rule.

## Where the money and tokens went

| Bucket (window) [transcripts]            | Sessions | Dollars |    Tokens | Share of dollars |
| ---------------------------------------- | -------: | ------: | --------: | ---------------: |
| Main checkout, top level                 |      138 |  171.40 |      955M |              50% |
| of which orchestrator `112bd8fe`         |        1 |   93.71 |      707M |              27% |
| of which Haiku judges                    |       99 |    3.24 |       60M |               1% |
| Writer worktrees (recorded and not)      |      122 |  151.58 |     1110M |              44% |
| Main-session subagents                   |      130 |   15.25 |       34M |               4% |
| Writer subagents (the retro skill forks) |        5 |    5.03 |        8M |               1% |
| **All**                                  |  **395** | **343** | **2108M** |         **100%** |

- 98% of all tokens are cache reads of a session's own context
  [transcripts]. So cost scales with **context size times request count**,
  not with the work a request does.
- **Plan-weighted, the window is 33.1 billion tokens** [plan-weighted]:
  - Sonnet: 1,151M raw, weighted ×20;
  - Opus: 165M raw, weighted ×40;
  - Haiku: 792M raw, of which 650M sit above the step and are weighted ×5.
- Per merged change: $343 / 135 merged PRs [ledger `pr.merged`] = $2.54, and
  15.6M raw tokens. The flow report's trailing 7 days show the same shape:
  orchestrate 149,885 and write 116,349 tokens per merged change, and review
  only 567 [flow report]. principles-review runs as a main-session subagent, so
  its tokens land in orchestrate.
- **By model**: Sonnet $216 (63%), Opus $78 (22%), Haiku $50 (15%)
  [transcripts]. The Opus $78.15 breaks down as:
  - the owner-facing session `5dfa430d`, $39.27;
  - a browser session `966a971c`, $13.97;
  - three other main-checkout sessions, $4.86;
  - the five retro writers and their forks, $18.97;
  - pieces under $0.50, the rest.
- **Writer launches** in the window, 78 [ledger `session.launch`]:
  - 35 Sonnet launches drawn by the 0040 window (`tierReason: experiment`);
  - 28 Haiku launches as its control (`experiment-control`);
  - 9 Sonnet grillers, by owner rule;
  - 5 Opus retro writers (owner decision 6);
  - 1 Sonnet relaunch after a third send-back.

  All judges, 99 of them, launched on Haiku at high effort [ledger].

- **Why the counts differ by source.** Haiku writers count 28 launches
  [ledger], 30 transcripts with a writer record [session records], and 47 Haiku
  worktree transcripts in all, which adds 17 with no record [transcripts]. A
  record exists per pane name, and a transcript per Claude session, so a
  resumed or relaunched pane adds a transcript but no record.

## Avoidable in principle

This is net of each change's own overhead, over 2.3 days, not annualized.
Cache reads above a cap are the cost of work that did ship, so these are
**avoidable in principle**, not waste.

- **E2 and E1 together: up to about $65 (about 19% of dollars) and about
  10.9 billion plan-weighted tokens (about 33%)**. Both depend on the cap the
  owner sets and on E3's outcome (findings 1 and 2).
- **Smaller, and overlapping with E2.** Each halves once the main session's
  context is capped, so they are not added to the line above:
  - polling, on idea 0019: about $7.5;
  - field-by-field PR reads: about $2.6;
  - one retry round on read-only guard blocks: about $2.

## Findings

### 1. Queue early compaction (E2) after E3, with the window's measured case

- **Evidence.**
  - The orchestrator `112bd8fe` made 2,871 requests at an average prompt of
    246,158 tokens [transcripts]. 2,520 of them were above 120k, carrying
    367.8M tokens above that line [transcripts]. The first is at
    `112bd8fe:86886`, and the largest prompt, 479,979 tokens, is at
    `112bd8fe:100124`.
  - The Opus session `5dfa430d` had 337 of 520 requests above 120k, 22.8M
    tokens over the line, first at `5dfa430d:3672` [transcripts].
  - The two sessions compacted 18 times, 9 each [ledger `session.compacted`].
  - `mainSessionSetups.compactionCap` is `null` and every stretch reads `not
set` [flow report]. `compactionCap` is read only for measurement:
    `token.split` readings, `session prompt-size` and the flow report [code].
  - `112bd8fe` has run since 2026-11-12, so this is long-standing.
- **Proposed change.** File E2 in idea 0038's sequence: after E3's recorded
  outcome, with the owner setting the cap after the baseline (owner decision
  3). E3 has no recorded outcome yet: there is no `outcome` event for 0038
  [ledger]. 120k here is an illustration only. The arm is an instruction in
  the main session's brief, as 0038 has it: read `harness session
prompt-size`, and at the cap run the `handoff` skill and compact.
- **Existing mitigation.** `harness hook context` restates the rules and open
  plan items after a compaction, and the `handoff` skill writes the plan state
  first. Neither is shown to carry the pane-to-PR mapping or an owner decision
  not yet written down.
- **Upper bound over the window.** These are not forecasts:
  - Gross: 390.6M raw tokens (367.8M + 22.8M), which is 8.27 billion
    plan-weighted (367.8M × 20 + 22.8M × 40), or $41.33 at the cache-read
    prices.
  - Overhead, an estimate: the two sessions wrote 5.06M new tokens to cache
    [transcripts]. At about 90k of growth per stretch, a cap like this means
    about 56 compactions instead of the recorded 18. That is 38 more at about
    150k tokens each, about 5.7M raw tokens and $7.
  - Net, an estimate: about 385M raw tokens, 8.15 billion plan-weighted, and
    $34. 5dfa430d's $39 is inside this figure, so it is not counted again
    below.
- **Quality risk.** A compaction drops in-flight state. That shows up as wrong
  merges, repeated reads, stalled panes and repeated owner questions.
- **Stop conditions** (copied from 0038):
  - guard margins and baselines are fixed from the control window before the
    arm opens;
  - a guard breach stops the arm;
  - a guard with too little data blocks judging;
  - the arm never overlaps the writer-tier window;
  - the owner opens the window.
- **Hypothesis.** If the main session hands over at the owner's cap, main-session
  cost per merged change falls, while 0038's guards hold.
- **Metric.** `writerCost.current`, read as the orchestrate bucket, down,
  14 days. Guards, as named in 0038: send-backs per merged change, stalled
  panes, owner overturns of advisor decisions, main-session follow-ups per
  writer session, and handovers. Margins come from the control window. The
  compaction count is a side figure.
- **Safety pattern.** `no-behaviour-change`, as an instruction in the brief
  only. The brief comes from `harness hook context` under
  `tools/harness/src/hook`, which ADR 0099 counts as developer tooling.
- **Already filed.** 0038 names E2 and files it after E3's recorded outcome.

### 2. Queue Haiku under the step (E1) after the 0040 window and E3, with the window's measured case

- **Evidence.**
  - 47 Haiku worktree sessions made 4,591 requests [transcripts]. 3,233 of
    them (70%) had prompts above 100k, carrying 626.0M prompt tokens, 302.7M
    of them above the line [transcripts].
  - Those requests cost $42.97; at the base step they would have cost $8.59.
    That is a **$34.38 premium, 75% of Haiku worktree dollars** ($45.7)
    [transcripts].
  - Examples: `3071a1af` (database-certs-local-ca), 282 of 307 requests over
    100k, first at `3071a1af:338`, peaking at 465,568 at `3071a1af:3614`;
    `798ba953` (loopback-443-cutover), 193 of 219, first at `798ba953:216`.
  - Haiku's `over100kShare` is 0.66 against Sonnet's 0.42 [flow report].
  - This is new since writers moved to Haiku (2026-11-17 to 19).
- **Untested hypothesis on the cause.** Over all worktree sessions, excluding
  the retro writers [transcripts]:

  |                       | Haiku (47 sessions) | Sonnet (66 sessions) |
  | --------------------- | ------------------: | -------------------: |
  | Output tokens         |              92,701 |               38,133 |
  | Requests (4,591 / 47) |                  98 |                   56 |
  | Largest prompt        |                192k |                 115k |
  | Tool-result tokens    |           about 42k |            about 33k |

  The model's own output may be what fills the context. Only a Haiku-at-medium
  window could test that, and 0040 holds the window effort at high.

- **Proposed change.** Treat these figures as evidence for E1 and for 0040's
  readout. E1 waits for the 0040 window to close, because 0040 merges no
  prompt-size mechanism inside the window, and it also comes after E3, by
  0038's order. No mechanism exists today: nothing applies a cap at spawn
  [code]. So E1 would be a new build, and its mechanism is the owner's choice.
- **Upper bound over the window.**
  - Gross: the over-step requests are 3,130M plan-weighted (626.0M × 5).
    Under a 100k cap they would carry at most 323.3M at weight 1, saving up
    to 2.81 billion plan-weighted, or $34.38.
  - Overhead, an estimate: compacting at about 95k down to about 25k is about
    2.4 compactions per session ((192k − 25k) / 70k). Over 47 sessions that is
    about 113 compactions at about 120k each, or 13.5M raw tokens.
  - Net, an estimate: about 2.79 billion plan-weighted and about $31.
- **Quality risk.** Haiku is blocked more often already: a blocked share of
  0.33 against 0.10, and 0.6 send-backs per merged change against 0.31
  (`writerArms.overall` [flow report]). A compaction in the middle of a TDD
  loop could raise both.
- **Hypothesis.** If a Haiku writer stays under the step, Haiku's all-in cost
  per merged change falls, while its blocked share and send-backs hold.
- **Metric.** `writerCost.current`, down, 14 days, read for the Haiku tier.
  Guard: `sendBacksPerMergedChange.current`.
- **Safety pattern.** None until the owner picks a mechanism.
- **Already filed.** 0038 names E1 and files it after E3; 0040 holds the
  window.

### 3. Read a PR's state in one `gh pr view` call (a brief line)

- **Evidence.**
  - In `112bd8fe`, 390 requests ran a `gh pr view --json` that read the head
    SHA, review decision or merge state, carrying 100.8M prompt tokens
    [transcripts].
  - 190 of them already read several fields in one call; the other 200 read a
    single field, 51.8M tokens [transcripts].
  - The main session already uses the multi-field form, so no new command is
    needed.
- **Proposed change.** One line in the brief that `harness hook context` gives
  a fresh main session: read a PR's head, review decision and merge state in
  one `gh pr view <n> --json headRefOid,reviewDecision,mergeStateStatus`
  call.
- **Savings over the window, an estimate.** If the 200 single-field reads fold
  in pairs, about 26M raw tokens, 0.52 billion plan-weighted, and $2.6. This
  halves again once finding 1 caps the context, so findings 1 and 3 are not
  added together.
- **Quality risk.** Low: the same data, read once.
- **Hypothesis.** If the brief names the multi-field read, the main session's
  single-field PR reads fall.
- **Metric.** None that only this moves (ADR 0119). It shares the orchestrate
  bucket with E3 and E2, so it is a brief line, not an idea.
- **Safety pattern.** `no-behaviour-change`
- **Already filed.** None.

## Notes on filed ideas (dropped as findings)

- **Polling: a note on idea 0019**, whose primary is
  `mainSession.foregroundPollMinutesPerMerged`. Idea 0035's primary is
  `mainSession.signedSendShare`, and 0038 is E3.
  - In `112bd8fe`, 678 requests only polled, 167.0M tokens and 23.6% of its
    prompt tokens [transcripts]:
    - 166 sleep or `until` loops, first at `112bd8fe:87151`;
    - 152 CI check reads, first at `112bd8fe:88451`;
    - 95 pane reads, first at `112bd8fe:86943`;
    - 160 status reads;
    - 105 Monitor reads.
  - `harness wait` ran in 211 requests beside the polls [transcripts].
  - Only the first three, 413 requests and 99.6M tokens, are what `harness
wait --pr` or `--session` replaces. Status reads answer questions other
    than "is it done", and Monitor is already event-driven, so those two
    stay out of the saving.
  - If one wait in four remains: 0.75 × 99.6M = 75M raw tokens, 1.49 billion
    plan-weighted, about $7.5. This overlaps with E3 and halves under E2.
  - The retro scan reports 1,525 minutes of polling, 891 pane reads and 890
    raw sends against 44 signed sends [retro scan].
  - `finishDetection.neverNoticed` is 308 of 552 [flow report].
- **Guard blocks: a note on ideas 0031** (`guardBlocksByRule.role-read-only`)
  **and 0033** (`guardBlocksByRule.role-worktree`). 0011 is the older, broader
  idea.
  - There were 303 `guard.block` events [ledger]: `role-read-only` 240,
    `role-worktree` 49, `role-no-merge` 8.
  - The blocked request is paid anyway, so the waste is one extra retry round.
    For the 240 read-only blocks that round is 27.8M raw tokens, 457M
    plan-weighted and $4.08, at each session's average request [transcripts].
  - How many are false positives is not measured. The scan sampled 3 blocks
    [retro scan]. `harness guardrail replay` and the guard corpus would
    measure it. At half, the round is about 14M raw tokens, 229M plan-weighted
    and $2.
  - By owner decision 5, the only fix in scope is the scratchpad-redirect
    quick fix to the existing rule: no loop or substitution parsing, and no
    new rule (decision 1).
- **Writer tier: a note on idea 0040.**
  - The proposed brief line already exists: ticket 1068 and PR 1076, where the
    main session names no model while the window is open.
  - The 44 Sonnet writers are mostly the window's own draws: 35 of the 78
    launches [ledger].
  - Hand-picked launches still thin the randomized sample:
    `writerArms.excluded.notRandomized` is 16 [flow report]. Whether every
    hand-pick follows ticket 1068 is a compliance question for 0040's
    readout.
  - The per-session cost gap is confounded by ticket size, and 0040 exists to
    settle the tier.
- **Idea stamping: a note on idea 0012** (`attribution.withIdeaAndStage`).
  - None of the 205 launches in the window carries an idea. 204
    `spawn.unstamped` events, none with a `--no-idea` reason [ledger]:
    99 judges, 77 writers, 14 readers and 14 principles-review.
  - `--no-idea` spawns are recorded as `spawn.unstamped` too [code].
  - `writerCost.current.unjoinable` is 480 of 560 merged changes [flow
    report].
  - Of 530 PRs merged since 2026-11-13, 139 carry an `Idea:` line naming an
    idea [gh]. So stamping could join at most about 139 changes; the rest
    serve no idea.
  - No refusal is proposed: it would be a new guard (decision 1), and judges
    and principles-review (113 of the 204) would answer it with boilerplate.

## Observations (not findings)

- **Judge effort.** All 99 judges launched at high effort [ledger], while
  `judge.md` sets medium. The window's effort setting reaches writers only
  (`tools/harness/src/session/spawn-experiment.ts:177`), so the high comes
  from the main session's `--effort`. The data for the decider (owner decision
  7): the 99 judge sessions cost $3.24 in all [transcripts].
- **Opus retro writers.** Five sessions and their forks cost $18.97
  [transcripts]. This was the owner's special case (decision 6). ADR 0117 says
  retro runs on Sonnet at high effort. No saving is proposed.
- **Owner-facing Opus sessions.** `5dfa430d` cost $39.27 and `966a971c` cost
  $13.97 [transcripts], together about 15% of dollars. These are listed with
  no verdict. 5dfa430d is also inside finding 1.
- **A possible glossary term**, only if the owner wants one: **Price step**,
  the 100k prompt length above which a Haiku request pays five times the rate
  on the whole request.

## Retro skill proposals not kept

- **principles-review is costly.** In the window it ran 90 times for $9.37 and
  12.1M tokens, $0.10 a review [transcripts]. That is 2.7% of dollars, and
  cheaper than any change that keeps the review. Leave it alone.
- **The retro scan runs out of memory** at node's default heap. That costs wall
  time, not tokens, and belongs to the determinism lens.
- **Remove the unused `add-policy` skill and `judgment` agent.** That saves
  about 60 tokens a request, about 0.9M over 15,424 requests. Too small to
  rank.

## Overall read

The delivery loop's cost is driven by context size, not by the work done. 98%
of the 2.1 billion raw tokens are cache reads, so a request costs what its
session already holds. The two levers that matter are the compaction caps that
the harness measures but does not apply. The main session carries an average
of 246k tokens through 2,871 requests, and Haiku writers pay the five-times
rate on 70% of their requests. Over 2.3 days that is up to about $65, or 10.9
billion of 33.1 billion plan-weighted tokens, avoidable in principle. Idea 0038
already queues both arms after E3, and the owner sets the cap. Polling, PR
reads and guard retries are each small, overlap with the caps, and already have
owners. Model choice matters less than it looks: the Sonnet writers are mostly
0040's own draws, and 0040 is where the tier gets settled. The largest blind
spot is measurement. No launch in the window carried an idea stamp, so cost
can be read only per window, not per idea.
