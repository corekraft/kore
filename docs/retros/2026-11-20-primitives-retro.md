---
summary: Primitives retro over the sessions from 2026-11-18T02:13:52Z to 2026-11-20, revised after its grill and the owner's decisions; five filing slots (pane traffic tools, judge and reviewer idea stamps, an after-merge step, one review path, a precheck false-positive fix), one finding held, one scope change to idea 0031, and the tick as the precondition. None filed or applied yet.
date: 2026-11-20
last-verified: 2026-11-20
---

# Primitives Retro 2026-11-20

The question for this retro: which multi-step sequences do agents build by hand
again and again, so that they should become one Tool (a harness command), a
hook or an agent role? It also asks which existing Tools agents bypass, and
which nothing calls. A bypass here means a hand-built sequence of commands that
a Tool already does. The word is used narrowly: idea 0022 uses it for evading a
Guardrail.

This is one of three independent retros of the same window. A grill pane tested
it, and the owner then decided its open questions. This revision applies the
grill's verdicts, its evidence corrections and the owner's decisions. Nothing
here is filed as an idea or applied.

## Owner decisions (2026-11-20, decided)

1. **The Guardrail freeze stays** (ADRs 0091, 0101, 0123). No new guard rule,
   not even in audit mode: no warning on raw herdr sends, bare `gh pr merge` or
   heredoc edits. Every Guardrail proposal from the first draft is dropped.
2. **The orchestrator tick should run.** Findings that depended on that
   decision now wait on the tick starting, not on a decision.
3. **No `--override` or `--accept` on `judge merge` in this retro.** If one is
   wanted later, it is a separate proposal with its own ADR.
4. **The read-only Guardrail gets no loop or substitution parsing.** Only the
   scratch-path redirect fix to the existing rule goes ahead.
5. **`review post --none` refuses when no review is recorded for the head.**
   This is accepted as a non-guard Tool rule.
6. **The other grill questions.** Two were not named on their own in the
   owner's list; the grill's recommendations stand for both:
   - the ADR 0126 bar for a writer stamp at spawn stays as it is, and this
     retro proposes no change to it
   - the precheck file-class fix (finding 5 below) is filed with its evidence
     list as an owner decision on the ADR 0099 boundary, each fix with its own
     ADR

The owner's decisions on context caps, writer models and judge effort belong to
the other two retros and change nothing here.

## Basis and method

- **Window and sources.**
  - **Window.** 2026-11-18T02:13:52Z to 2026-11-20T08:40Z.
  - **Transcripts.** 151 Claude Code transcripts: 71 from the main checkout and
    80 from worktrees, after leaving out the three retro writers. A record
    counts only if it is a `user` or `assistant` record with a timestamp inside
    the window. Copies of earlier requests (`api-request-blob` records) are left
    out. That leaves 10,614 tool calls, 8,430 of them Bash.
  - **Roles.** A session's role comes from its first prompt: "Judge PR" is a
    judge, "Review PR" is a reviewer, any other worktree session is a writer,
    and the rest are main sessions.
  - **The main session.** One long-running main session, `112bd8fe`, made 1,906
    of the window's Bash calls.
- **Ledger.** The ledger (`.kore/state/ledger.jsonl`) is filtered by
  `occurredAt` inside the window: 7,764 events that are not tool events.
  `.kore/state/sessions` agrees with its 196 `session.launch` events.
- **The flow report.** `flow-report.json` covers the whole ledger, so window
  figures here come from the transcripts or the filtered ledger. Each count
  below names its source:
  - **[T]** transcripts
  - **[L]** ledger, window only
  - **[F]** flow report, whole ledger
  - **[G]** GitHub, read with `gh pr view`
- **How a match is counted.**
  - **Per Bash call.** A count is of Bash calls whose command matches, unless it
    says "occurrences". A call that chains several commands counts once per
    pattern.
  - **Merges.** A merge is counted by the PR number after `gh pr merge` or
    `judge merge`, then checked against `pr.merged` [L].
  - **Quoted text.** Text inside a quoted comment body can match a pattern. Each
    count used below was checked for that.
- **Citations.** `session:line` points into the transcript JSONL and needs local
  transcript access to resolve. No transcript text is quoted here.
- **Every count is one pass.** None was recounted by a second reader.
  - **The shared scan.** It failed: `retro-scan --strict --evidence` ran out of
    Node heap, and its rerun has no evidence rows.
  - **The forked `/retro` pass.** It miscounted `harness wait` in `112bd8fe` as
    0 calls; the transcript has 161 calls [T].
  - **This retro's first draft.** It had four wrong figures, all corrected
    below:
    - 125 reviewed PRs, which counted verdict kinds, not PRs
    - 5 failed merges, from a loose match
    - a 0.0053 send share, a whole-ledger figure
    - an unaccounted remainder of 22 merges
  - **Conditional findings.** Findings 1 to 4, the held finding and the scope
    change stay conditional until a second reader pane recounts them.

## The tick comes first

The `orchestrator-tick` flag has been `true` in local since 2026-11-17 (#987).
Even so, the whole ledger has 0 events of any `tick.*` kind [L]. ADR 0121 has a
person start `orchestrate tick --loop` in a pane, so nothing started it.

The owner has decided the tick runs. Findings 3 and 4 and the held status Tool
measure work the tick takes over: merges, reviews, sweeps, reads and polls.
Their windows open once the tick is running and a new baseline is taken. ADR
0123's tick-off condition applies to those metrics, not to the send share.

The `judgment` agent is launched only by the tick. Keep it (against idea 0037's
removal) until the tick has run for one window.

## Ranking and filing

- **How findings are ranked.** By count, how clean the count is, whether a
  flow-report field already measures it, and how many prerequisites block it.
  There is no cost column, so this retro makes no "frequency times cost" claim.
- **The cap.** ADR 0118 caps a retro at 5 filed ideas. The slots, in order, are
  findings 1 to 5:
  - findings 1, 2 and 5 are ready to file
  - findings 3 and 4 are filed when unblocked, that is, when the tick runs and
    the new counters exist
- **Outside the cap.** The status Tool is held back for want of a slot.
  Finding 7 is a scope change to idea 0031 and uses no slot.
- **New counters.** Primaries marked "new counter" have no flow-report field.
  Each needs a retro-scan counter, written by the scan rather than by the code
  the change touches, and with no command text in the ledger (ADRs 0118, 0119
  and 0123). If the scan code is shared, file the four counters as one
  prerequisite ticket.

| #   | Finding                                   | Primary metric                                                       | Flow-report field                  | New counter? | Guard metrics                                                                | Slot          |
| --- | ----------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- | ------------ | ---------------------------------------------------------------------------- | ------------- |
| 1   | Session Tools do more than raw herdr      | signed share of main-session pane sends                              | `mainSession.signedSendShare`      | no           | `mainSession.paneReadsPerFinishedPane`                                       | 1, after 0035 |
| 2   | Judge and reviewer spawns stamp the idea  | share of judge and reviewer launches with no idea (`pr.linked` join) | none                               | yes          | `attribution.noRoleShare`                                                    | 2             |
| 3   | `judge merge --after-merge` chores step   | bare `gh pr merge` calls per merged PR                               | none                               | yes          | `tokensPerMergedChange.current`; merges past a failed precheck must not rise | 3, on tick    |
| 4   | One review path                           | `review post` verdicts with no recorded review, per merged PR        | none                               | yes          | `tokensPerMergedChange.current`; main-session context tokens                 | 4, on tick    |
| 5   | Precheck file-class fix                   | merges past a failed precheck, per merged PR                         | none                               | yes          | `rework.sendBacksPerIdea`                                                    | 5             |
| 6   | `orchestrate status` read-only Tool       | main-session sweep calls per merged PR                               | none                               | yes          | `mainSession.paneReadsPerFinishedPane`                                       | held          |
| 7   | Scratch-path redirect for read-only roles | `guardBlocksByRule.role-read-only`                                   | `guardBlocksByRule.role-read-only` | no           | the ADR 0119 corpus and replay conditions                                    | 0031 scope    |

## 1. Session Tools do more than raw herdr

- **Evidence (conditional):**
  - **Window counts [T], `112bd8fe`, counted as occurrences.**
    - Sends: 30 `session send` against 115 raw `herdr agent prompt`, none of
      which was a slash prompt.
    - `herdr pane send-text` and `send-keys`: 0.
    - The window's signed share is about 0.21 (30 of 145). Across every main
      session in the main checkout it is about 0.22 (37 of 167, after taking
      out 4 slash prompts).
    - Reads: 124 raw `herdr agent read` and 4 raw `herdr pane read`, against 58
      `session wait`.
    - Closes: 142 raw `herdr pane close`, against 50 `session close`.
  - **Ledger [L].** It records 38 `session.send` events.
  - **Against the baseline.** ADR 0123's baseline is 5 of 45 (about 0.11). So
    the share roughly doubled after the nudge flags went on; it did not stall.
    The first draft's 0.0053 is a whole-ledger figure [F] and is withdrawn, as
    is its claim that idea 0035 "has not moved".
  - **The model to follow.** `harness wait`, which does strictly more than a
    hand-built loop, was adopted: 161 calls [T].
  - **Citations:** `112bd8fe:86943`, `112bd8fe:94746` (raw reads),
    `112bd8fe:95291`, `112bd8fe:107976` (raw prompts).
- **Proposed change:** Tool work, not a Guardrail (owner decision 1).
  - Make each session Tool do strictly more than its raw herdr form:
    - `session send` returns the target's state
    - `session wait --json` returns the result summary and the last lines a raw
      read would show
    - `session close` closes several panes by name and reports the state of
      each
  - Offer only these Tools in the main session's context hook. Slash prompts
    stay on `herdr agent prompt`.
- **Hypothesis:** If the session Tools return everything the raw forms show and
  more, the main session uses them by preference, as it did with
  `harness wait`, and the signed share rises.
- **Metric:** `mainSession.signedSendShare`, up, 14 days. This is idea 0035's
  metric, so this idea's window opens after 0035's closes.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0035 (same metric; this is its Tool step).

## 2. Judge and reviewer spawns stamp the idea

- **Evidence:**
  - **Counts [L].** 195 `spawn.unstamped` events against 196 `session.launch`
    in the window, and none of the unstamped carries a reason. Judges and
    principles reviewers make 113 of the 195, all of their launches. 95 of
    those 113 labels name the PR, which already exists when they start.
  - **Citations:** the window's first `spawn.unstamped` event, for pane
    `w3:p183`.
- **Proposed change:** In `harness session spawn`, for the judge and
  principles-review roles only, read the idea from the PR's `Idea:` line when no
  idea is given. Writer spawns are left alone: ADR 0126 decided a writer's idea
  is read from its PR on `pr.linked`, because a writer starts before its PR
  exists. Record this as an ADR that narrows ADR 0126, not one that reverses it.
- **Hypothesis:** If judge and reviewer spawns take the idea from their PR,
  their sessions carry an idea, and attribution by role improves without
  touching the writer path.
- **Metric:** the share of judge and reviewer launches with no idea, read from
  `pr.linked` joins rather than from the spawn's own `spawn.unstamped` events
  (ADR 0119). Down, 14 days. This is a new counter; `attribution.noRoleShare`
  [F] (0.56) is a guard.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0012 (issue #799), #827 (warn and record) and ADR 0126.
  This narrows ADR 0126 to the roles whose PR already exists.

## 3. `judge merge --after-merge` chores step

- **Evidence (conditional):**
  - **The merged set.** The window has 131 `pr.merged` events [L].
    - 93 of them came from a bare `gh pr merge` [T] (71 percent of 131, 85
      percent of the 109 merges a transcript call can be tied to).
    - 16 came from `judge merge` [T].
    - The other 22 were all merged under the owner's account [G]: 7 release
      PRs, 5 VPS infrastructure PRs, and 10 whose numbers no window transcript
      call names (at least one loop merged a variable PR number).
  - **The briefs.** Judge briefs said "approve only; do not merge" 123 times
    [T].
  - **Chained chores [T].** Of 103 Bash calls that ran `gh pr merge`:
    - 75 chained `git pull --ff-only`
    - 58 chained the harness build
    - 48 chained `gh issue close`
    - 45 chained a pane close
    - 34 chained `git worktree remove`
    - 60 used `--admin --match-head-commit`
  - **Failed merges [T].** Two, listed apart from the rest:
    - one refused by branch policy (`112bd8fe:99291`)
    - one given a short SHA for `--match-head-commit` (`112bd8fe:99321`), which
      cannot happen through `judge merge`
  - **Citations:** `112bd8fe:86943`, `112bd8fe:92034` (merge and all five chores
    in one call).
- **Proposed change:** A non-guard Tool under ADR 0101: `judge merge <pr>
--after-merge`, or a separate `judge after-merge <pr>`. It runs only after a
  normal passing precheck and a successful merge. It:
  - pulls the main checkout fast-forward only
  - rebuilds the harness bundle
  - closes the PR's judge and writer panes with
    `session close --remove-worktree`

  It never closes a `Refs` issue (ADR 0097) and never runs
  `gh pr update-branch`, which changes the head and voids the approval
  (ADR 0109).

  The name avoids "land", which the glossary keeps for "land on trunk", and
  "finish", which would collide with finish detection. There is no `--override`
  (owner decision 3).

- **Hypothesis:** If the chores after a merge are one Tool step, the main
  session stops chaining them by hand, and its bare `gh pr merge` calls fall.
- **Metric:** bare `gh pr merge` calls per merged PR, down, 14 days, from the
  window after the tick starts. This is a new counter. Guards:
  - `tokensPerMergedChange.current` [F]
  - merges past a failed precheck must not rise
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none.

## 4. One review path

- **Evidence (conditional):**
  - **Verdicts posted [T].** The main session posted verdicts with
    `harness review post` on 108 distinct PRs. 98 of them had a `--none`
    verdict, and 18 had both a `--none` and a findings verdict. The first
    draft's 125 counted verdict kinds, not PRs.
  - **Where the 108 reviews came from:**
    - 69 were reviewed in process: an `Agent` call to principles-review in
      `112bd8fe` names the PR.
    - 1 was reviewed by `review run`.
    - 0 were reviewed by a reviewer pane (9 reviewer panes ran in the window,
      for other PRs).
    - 38 have no review visible anywhere in the main session's transcript.
  - **What the 38 change [G].** All 38 carry `--none`. 30 change only docs or
    developer tooling, and 8 also touch product paths.
  - **Context cost [T].** The in-process reviews put 73 review prompts and
    their results in the main session's context. They also caused 74
    `role-read-only` blocks that the ledger attributes to `112bd8fe` [L]; that
    is a side effect, not a claim of this finding.
  - **Citations:** `112bd8fe:95551`, `112bd8fe:103946` (in-process review
    launches), `112bd8fe:106372` (`review post --none` chained with the
    precheck and a merge).
- **Proposed change:** Two Tool rules, neither a Guardrail:
  - the main session's context names `review run <pr>` as the review path
  - `review post --none` refuses unless a `review.run` event or a recorded
    review exists for that head (owner decision 5)

  This changes which path runs a review, not whether one runs. Idea 0016's
  question, whether principles-review belongs in the loop, is a separate one.

- **Hypothesis:** If reviews run through `review run`, and a no-findings verdict
  needs a recorded review, then verdicts with no review behind them fall to
  zero. Review transcripts also leave the main session's context.
- **Metric:** `review post` verdicts with no recorded review for the head, per
  merged PR, down, 14 days, from the window after the tick starts. This is a
  new counter, with a baseline of 38 of 108. Guards:
  - `tokensPerMergedChange.current` [F]
  - the main session's context tokens
- **Safety pattern:** `feature-flagged`. The `--none` refusal is a process
  change the owner accepted (decision 5), so it is not `no-behaviour-change`.
  The context line rides behind the same flag.
- **Already filed:** none. Idea 0016 (whether principles-review runs) is
  related; its primary is `rework.sendBacksPerIdea`, so the two don't clash.

## 5. Precheck file-class fix

- **Evidence (conditional):**
  - **Override comments [T].** The main session wrote 26 signed merge comments
    to explain merging past the precheck. Read one by one and classified by
    their stated cause:
    - 12: the precheck refused `feature-flagged` only because the flag already
      existed, off in every overlay
    - 3: developer tooling under `tools/kore/src` was read as a behaviour
      change
    - 1: a test refactor was read as a contract step
    - 10 named no precheck mismatch; they cite unverified gating or
      cluster-facing proof owed before the flag turns on, or nothing
  - **So.** Precheck false positives (16 of 26) are the leading cause of these
    overrides.
  - **Citations:** `112bd8fe:102158` (existing flag), `112bd8fe:102574`
    (developer tooling), `112bd8fe:110227` (test refactor).
- **Proposed change:** In the judge precheck's pattern matcher:
  - accept `feature-flagged` when the diff reads a flag that already exists and
    is off in every overlay
  - treat named measurement and load helpers as developer tooling, as ADR 0099
    and its amendment list them

  These change what merges without approval, so they are owner decisions on
  the ADR 0099 boundary, each fix with its own ADR. The boundary fails closed.

- **Hypothesis:** If the precheck recognizes an existing off flag and the named
  tooling paths, honest declarations pass it. Merges past a failed precheck
  then fall without any override.
- **Metric:** merges past a failed precheck (an `--admin` merge with a precheck
  mismatch), per merged PR, down, 14 days. This is a new counter.
  `rework.sendBacksPerIdea` is a guard.
- **Safety pattern:** `dark-launched`. The new matcher runs beside the old one
  and records where they disagree, until the owner switches it.
- **Already filed:** none.

## Held: `orchestrate status` read-only Tool

- **Evidence (conditional) [T].** These counts are for `112bd8fe`:
  - 114 calls ran `pmset -g batt`
  - 89 combined it with an open-PR or pane listing
  - 157 ran `gh pr list --state open` with check or merge state
  - 146 ran `herdr agent list`

  Citations: `112bd8fe:87345`, `112bd8fe:103901`, `112bd8fe:117345`.

- **Proposed change:** A read-only, event-free Tool under the tick work. It
  reuses the tick's state and the latest `host-sample` event, so one owner holds
  the power and load rule. It prints live panes and open PRs with head, checks,
  merge state and declared pattern.

  The first draft's `core.bare` line is dropped, because `kb-check` already
  reports that with its cause. Only add it back if the 102 hand checks show the
  report goes unseen.

- **Metric:** main-session sweep calls per merged PR, down, 14 days. This is a
  new counter; `mainSession.paneReadsPerFinishedPane` is a guard.
- **Safety pattern:** `no-behaviour-change`
- **Why held:** No filing slot is left, and it waits on the tick starting.
- **Already filed:** none.

## Scope change to idea 0031: scratch-path redirect for read-only roles

- **Evidence (conditional) [L].** 240 `role-read-only` blocks in the window:
  - 112 judge
  - 48 reader, which includes 6 from grill answerer panes started before the
    window
  - 6 principles-review pane
  - 74 from the main session's in-process reviewers

  Without the in-process reviewers, the baseline is 166.

  Of the 71 block messages in transcripts [T], 6 are stdout redirects into the
  session's own scratch or tool-results folder. Loops, substitutions and stderr
  redirects stay blocked (owner decision 4).

  Citations: `1239f264:120`, `1239f264:143`, `1239f264:259`.

- **Proposed change:** In the existing `role-read-only` rule, allow a stdout
  redirect on an allowed read only into the session's one exact scratch path:
  no `..` and no symlink. This is a quick fix to an existing rule. The ADR 0119
  conditions for a Guardrail idea hold:
  - the corpus still blocks every known-bad case in CI
  - the replay lists every newly allowed command
  - any allowed command that leaves the worktree or writes outside its role
    refutes the idea

  Add a corpus case for each bypass named in idea 0022.

- **Metric:** `guardBlocksByRule.role-read-only`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0031, which covers readers only. It records no issue or
  outcome, so its window has not opened. This adds judges to its scope and uses
  no filing slot.

## Tools nobody calls

- **`orchestrate tick` and `judgment`.** See "The tick comes first".
- **The `add-policy` skill.** It was loaded 0 times, although two policy
  changes merged in the window (#1332, #1339). Rewrite its description so it
  triggers, rather than delete it (idea 0037).

## Not kept

- **Heredoc edits (the first draft's finding 5).**
  - **Counts [T].** Writers made 360 Python heredoc edits of tracked files, all
    after #912 told them to write files with the Write tool (merged
    2026-11-16). That is against 837 `Edit` calls.
  - **The baseline.** The grill asked for one. After each edit I classified the
    next Bash result in the same writer session, counting only type, test,
    format and lint failures:
    - after `Edit`: 81 of 370 checked results (22 percent)
    - after heredoc edits: 71 of 276 (26 percent)
  - **Dropped.** The rates are similar, so the finding is dropped.
  - **Unchanged.** A Guardrail was decided against: idea 0022, #845 and PR #902
    closed wontfix on 2026-11-17, and owner decision 1. The 2026-11-30 re-check
    of idea 0022 stands.
- **Hand-written writer briefs.** The forked `/retro` pass found writer briefs
  restating rules that `writer.md` and `pr open` already enforce. It is a
  smaller saving, and it touches the same spawn path as finding 2.
- **The report-version literal.** Five spec files assert a report-version
  literal, so a version bump is a five-file edit. That is a test cleanup, not a
  missing Tool.
- **Updating PR branches.** `gh pr update-branch` ran in 108 Bash calls [T].
  Idea 0023 covers it only once its `behind-main-notice` flag is on; the flag
  is off in local, and 0023 sends a writer a message rather than running
  `update-branch`. `judge merge` itself names `gh pr update-branch` as the next
  step when a PR is behind. Keep 108 as a baseline: it measures something
  different from 0023's 45 sends. Do not fold it into the after-merge step,
  since it changes the head and voids the approval (ADR 0109).

## Overall read

The harness already has most of the Tools this window needed. The costly
pattern is bypass: the main session rebuilds those Tools by hand, rather than
any Tool being missing.

What the bypass looked like:

- **Merges.** The main session merged 93 of 131 PRs with a bare `gh pr merge`
  and the same chained chores.
- **Reviews.** It reviewed 69 PRs in process and posted 38 no-findings verdicts
  with no review visible behind them.
- **Panes.** It still sends most pane messages raw, though the signed share
  rose from about 0.11 to about 0.21.
- **The precheck.** Its false positives explain most of the hand-written merge
  overrides.

What changed habits was a Tool that does strictly more than the hand-built
loop: `harness wait`. Reminder lines did less. So the way forward is to fold
the chores into the Tools (the after-merge step, the session Tools, one review
path), fix the precheck's false positives at their cause, and start the tick
that was built to carry this work.

Guardrails are out of scope while the freeze holds. Any Guardrail proposal goes
to the owner as its own decision.
