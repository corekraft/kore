---
summary: Primitives retro over the sessions from 2026-11-18T02:13:52Z to 2026-11-20; seven proposals for hand-built sequences that should be one harness primitive, and existing primitives the main session bypasses. None filed or applied yet.
date: 2026-11-20
last-verified: 2026-11-20
---

# Primitives Retro 2026-11-20

The question for this retro: which multi-step sequences do agents build by hand
again and again, so that they should become one named primitive (a harness
command, a hook, a tool or an agent role)? It also asks which existing
primitives agents bypass, and which nothing calls. It is one of three
independent retros of the same window. Its findings are proposals: none is
filed as an idea or applied.

## Basis

- **Window.** 2026-11-18T02:13:52Z to 2026-11-20T08:40Z. The input was 151
  Claude Code transcripts, 71 from the main checkout and 80 from worktrees.
  Only `user` and `assistant` records with a timestamp inside the window were
  counted: 10,614 tool calls, 8,430 of them Bash. Copies of earlier requests
  (`api-request-blob` records) were left out.
- **Launches.** The ledger shows 196 `session.launch` events: 98 judge, 72
  writer, 10 reader, 9 principles-review, plus 7 others. `.kore/state/sessions`
  agrees.
- **The main session.** One long-running main session, `112bd8fe`, made 1,906
  of the window's Bash calls. Most of the findings below are about it.
- **The precomputed inputs.** The first `retro-scan --strict --evidence` run ran
  out of Node heap. The rerun has no evidence rows, so guard-block forms below
  come from the transcripts. `flow-report.json` covers the whole ledger, not
  just the window, so window counts come from the ledger
  (`.kore/state/ledger.jsonl`) filtered by `occurredAt`.
- **The forked `/retro` pass.** It ran with the primitives topic as its lens,
  and its proposals are folded in below. Its claim that `112bd8fe` used
  `harness wait` 0 times in the window is wrong: the transcript has 161 such
  calls. Its scan run also added `retro.main-session` events to the ledger.
- **Citations.** `session:line` points into the transcript JSONL. Only counts
  are cited here, never transcript text.

## The seven findings, ranked by frequency times cost

| #   | Change                                                             | Hand-built count in window                        | Already filed             |
| --- | ------------------------------------------------------------------ | ------------------------------------------------- | ------------------------- |
| 1   | One `land` step: the judge's merge plus the post-merge chores      | bare `gh pr merge` on 93 PRs, `judge merge` on 16 | none                      |
| 2   | Main session posts reviews through `review run`                    | 73 in-process reviews, 125 PRs hand-posted        | 0016 (related)            |
| 3   | Main-session raw pane sends, reads and closes go through `session` | 107 raw prompts, 123 raw reads, 116 raw closes    | 0035                      |
| 4   | One read-only status snapshot for the main session                 | about 100 hand-built sweeps                       | none                      |
| 5   | Writers edit through Edit, not Python heredocs                     | 402 heredoc edits in 44 sessions                  | none                      |
| 6   | `session spawn` stamps the idea itself                             | 195 of 196 launches unstamped                     | 0012, #827 (both partial) |
| 7   | Read-only roles get batch and redirect forms                       | 240 `role-read-only` blocks                       | 0031 (readers only)       |

## 1. One `land` step: the judge's merge plus the post-merge chores

- **Evidence:**
  - **Bypass.** The ledger has 131 `pr.merged` events in the window. The main
    session ran a bare `gh pr merge --squash` on 93 distinct PRs itself;
    `harness judge merge` ran on 16.
  - **The briefs.** Judge briefs said "approve only; do not merge" 123 times.
    So the main session, not the judge, carried out the merge.
  - **The chained chores.** Of 103 commands that ran `gh pr merge`:
    - 75 chained `git pull --ff-only`
    - 58 chained `mise run harness-build`
    - 48 chained `gh issue close`
    - 45 chained a pane close
    - 34 chained `git worktree remove`
    - 60 added `--admin --match-head-commit`
  - **Hand-written overrides.** 26 merge comments were written by hand, each
    explaining why a precheck mismatch was overridden.
  - **Failures.** 5 merge commands failed: one was refused by branch policy,
    and one passed a short SHA to `--match-head-commit`.
  - **Citations:** `112bd8fe:86943`, `112bd8fe:92034` (merge, pull, build,
    issue close, pane close and worktree remove in one call), `112bd8fe:113963`
    (`--admin` after grepping the precheck), `112bd8fe:99321` (short-SHA
    failure), `112bd8fe:110227` (hand-written override comment).
- **Proposed change:** Add `harness judge merge <pr> --land` to the main
  session's surface, as a harness command. It:
  - merges the verified head as today
  - pulls the main checkout fast-forward only, and rebuilds the harness bundle
  - closes the PR's judge and writer panes with
    `session close --remove-worktree`
  - closes the issue only when the PR says `Closes`

  An owner-authorized override becomes `--override "<reason>"`. It pins the
  full head SHA, posts the signed reason comment and writes a ledger event, in
  place of the hand-written comment and `gh pr merge --admin`.

- **Hypothesis:** If landing a PR is one command, the main session stops
  chaining six commands for each merge, and its tokens per merged change fall.
  Overrides also become countable in the ledger, not just in comments.
- **Metric:** `tokensPerMergedChange.current`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none.

## 2. Main session posts reviews through `review run`

- **Evidence:**
  - **The hand-built path.** The main session started 119 in-process `Agent`
    calls; 73 of them were principles reviews of a PR. It then posted verdicts
    by hand with `harness review post` on 125 distinct PRs. On 97 of those it
    posted `--none`, a no-findings verdict.
  - **The primitive.** `harness review run`, which spawns the reviewer at its
    declared tier, waits and posts for the same head, was called by the main
    session for 5 PRs.
  - **Blocks.** The in-process reviewers also caused 74 of the window's
    `role-read-only` blocks, which the ledger attributes to `112bd8fe`.
  - **Citations:** `112bd8fe:95551`, `112bd8fe:103946` (in-process review
    launches), `112bd8fe:106372` (`review post --none`, precheck, comment and
    merge in one call).
- **Proposed change:** In the orchestrator agent definition and the main
  session's context hook, name `review run <pr>` as the only review path. Add
  an audit-mode guard on `review post` from the main session when no
  `review.run` spawn exists for that head. The guard lives in `hook guard`, in
  audit mode first per AGENTS.md.
- **Hypothesis:** If the main session reviews through `review run`, reviews run
  at the recorded tier in their own pane. That takes 73 review transcripts out
  of the main session's context, so its tokens per merged change fall.
- **Metric:** `tokensPerMergedChange.current`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none directly. Idea 0016 asks whether principles-review
  runs in the loop at all; this finding is about which path runs it.

## 3. Main-session raw pane sends, reads and closes go through `session`

- **Evidence:**
  - **Window counts.** In `112bd8fe` there were:
    - 107 raw `herdr agent prompt` sends, against 30 `session send`
    - 123 raw `herdr agent read` reads, against 58 `session wait`
    - 116 raw `herdr pane close` closes, against 50 `session close`
  - **Ledger.** The ledger has 38 `session.send` events in the window.
  - **Flow report.** The flow report has `mainSession.signedSendShare` at
    0.0053 (8 signed, 1,491 raw) and `mainSession.paneReadsPerFinishedPane` at
    28.2.
  - **Long-standing.** Idea 0035 counted 747 raw sends before this window. The
    nudge flags `signed-main-sends` and `pane-result-summary` were turned on in
    local just before the window opened, and the share did not move. The
    `harness wait` tool, by contrast, was adopted: 161 calls.
  - **Citations:** `112bd8fe:86943`, `112bd8fe:94746` (raw reads),
    `112bd8fe:95291`, `112bd8fe:107976` (raw prompts).
- **Proposed change:** Add an audit-mode guard in `hook guard` for the main
  session on these raw commands, each pointing to its primitive:
  - `herdr agent prompt` and `herdr pane send-text`: `session send`
  - `herdr agent read` and `herdr pane read`: `session wait --json`
  - `herdr pane close`: `session close`

  Exempt prompts that start with `/`, which are slash skills and must go
  through herdr.

- **Hypothesis:** If the main session is told which primitive to use each time
  it reaches for raw herdr, its signed send share rises and its pane reads per
  finished pane fall.
- **Metric:** `mainSession.signedSendShare`, up, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0035. That idea has the same metric and has not moved, so
  this is its next step: from a reminder to an audit-mode rule.

## 4. One read-only status snapshot for the main session

- **Evidence:**
  - **Counts.** `112bd8fe` ran `pmset -g batt` 114 times and
    `git config core.bare` 102 times. 100 commands combined the two, and 89
    combined `pmset` with an open-PR or pane listing. The same window also has:
    - 157 `gh pr list --state open` calls with `statusCheckRollup` or
      `mergeStateStatus`
    - 146 `herdr agent list` calls
    - 57 `for` loops over PR or issue numbers
  - **What it is.** One hand-built status sweep: power state, a repo sanity
    check, open PRs with head, checks and merge state, and live panes.
  - **Citations:** `112bd8fe:87345`, `112bd8fe:103901`, `112bd8fe:117345`.
- **Proposed change:** Add a read-only `harness orchestrate status [--json]`. It
  prints:
  - host power and load, from the latest `host-sample` ledger event
  - whether `core.bare` is set
  - live panes with their last ledger state
  - open PRs with short head, checks, merge state and declared pattern

  The repeated `core.bare` check is also a sign of a past incident: find its
  cause and fix it at the root.

- **Hypothesis:** If one command answers "what is open and what is the host
  doing", the main session stops rebuilding the sweep about 50 times a day and
  reads panes less.
- **Metric:** `mainSession.paneReadsPerFinishedPane`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none.

## 5. Writers edit through Edit, not Python heredocs

- **Evidence:**
  - **Counts.** 402 Bash calls did a `python3 - <<EOF` read-replace-write edit
    of a tracked file, in 44 sessions: 360 from writers and 42 from other
    sessions. That is against 851 `Edit` calls in the window.
  - **Errors.** Of the 299 results that followed directly, 35 show an error: a
    Python traceback, or a type or test failure from the edit.
  - **Hooks miss them.** The post-edit format-and-lint hook runs for Write and
    Edit only (`tools/harness/src/hook/feedback.ts:78`). The role guard flags
    `python -c` but not a heredoc script
    (`tools/harness/src/hook/guard-role-delivery.ts:53`). So these edits skip
    both hooks.
  - **The definition says otherwise.** `.claude/agents/writer.md:27` already
    says to write scripts with the Write tool, not a heredoc.
  - **Citations:** `0bf5938f:288` (27 such edits in one session),
    `8efd617d:228`, `dfbdbfd5:308`, `19b8a907:147` (a heredoc edit that
    failed).
- **Proposed change:** Add an audit-mode `heredoc-edit` rule in `hook guard`. It
  flags a Python or Perl heredoc that opens a worktree file for writing, and
  points to `Edit` with `replace_all`. A second option: make the post-edit
  feedback also run on Bash calls that changed tracked files.
- **Hypothesis:** If heredoc edits are flagged and pointed at Edit, format and
  lint problems surface at edit time rather than at commit or review, so fewer
  changes are sent back.
- **Metric:** `rework.sendBacksPerIdea`, down, 14 days. This is a proxy: no
  flow report metric counts heredoc edits yet.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none.

## 6. `session spawn` stamps the idea itself

- **Evidence:**
  - **Counts.** The ledger has 195 `spawn.unstamped` events against 196
    `session.launch` in the window. None of the 195 carries a reason. Judge
    spawns already name their PR in the label (180 of 195 have one).
  - **The flow report.** `attribution.noRoleShare` is 0.56, and `rework` and
    `metrics` report "insufficient history" for lack of stamped ideas.
  - **Citations:** the ledger `spawn.unstamped` events, for example the first
    of the window, for pane `w3:p183` (`merge-dates-judge`). Also
    `112bd8fe:101981` (a writer spawn loop with no idea).
- **Proposed change:** In `harness session spawn`, work out the idea when none
  is given:
  - from the PR's `Idea:` line, for judge and reviewer spawns
  - from the issue's idea link, when `--issue` is given

  Refuse with the reason flag named only when neither exists. The change lives
  in the spawn command.

- **Hypothesis:** If the spawn stamps the idea itself, unstamped spawns fall
  near zero, and the per-idea metrics leave "insufficient history".
- **Metric:** `unstampedSpawns.total`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0012 (stamping, issue #799) and #827 (warn and record).
  Both record the gap; neither works out the idea for the caller.

## 7. Read-only roles get batch and redirect forms

- **Evidence:**
  - **Counts.** The ledger has 240 `role-read-only` blocks in the window: 112
    in judges, 42 in readers, 6 in principles-review panes, and 74 in the main
    session's in-process reviewers.
  - **The forms.** Of the 71 block messages in transcripts:
    - 23 name a redirect such as `2>&1`, `2>/dev/null` or `> file`, on a read
      that is otherwise allowed
    - 10 are command or process substitutions
    - the rest are mostly `for` loops over issue or PR numbers, and
      `judge diff` output saved to the session's own folder
  - **Long-standing.** `flow-report.json` counts 730 `role-read-only` events
    across the whole ledger.
  - **Citations:** `1239f264:120`, `1239f264:143`, `1239f264:259` (one judge,
    4 blocks).
- **Proposed change:** In the `role-read-only` rule of `hook guard`:
  - allow stderr redirects, and stdout redirects into the session's own
    scratch or tool-results folder, on an allowed read
  - add a batch form to the reads the judge runs most: `judge diff --page`, and
    `gh issue view` for several numbers

  Extend idea 0031's change from readers to judges.

- **Hypothesis:** If the common read forms are allowed, judges and readers stop
  retrying after a block, and the rule's block count falls.
- **Metric:** `guardBlocksByRule.role-read-only`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0031, which covers reader panes only.

## Primitives nobody calls

- **`orchestrate tick` and the `judgment` agent.** There are 0 tick events in
  the window, and the tick is the only thing that launches `judgment`
  (ADR 0121). The tick would take findings 1, 2 and 3 off the main session, so
  the open question is whether the tick runs, not whether to delete
  `judgment`. Idea 0037 proposes removal; this retro recommends against it
  until the tick decision is made.
- **The `add-policy` skill.** It was loaded 0 times, although two policy
  changes merged in the window (#1332, #1339). Rewrite its description so it
  triggers, rather than delete it. Also covered by idea 0037.

## Not kept

- **Hand-written writer briefs.** The forked `/retro` pass found the main
  session's writer briefs restating rules that `writer.md` and `pr open`
  already enforce. A `session spawn --issue N` brief builder would answer it.
  That is a smaller saving than the seven above, and finding 6 touches the
  same spawn path.
- **The report-version literal.** Five spec files assert a report-version
  literal, so bumping the version is a five-file edit (11 sampled
  `role-worktree` blocks). That is a test cleanup, not a missing primitive.
- **Updating PR branches.** `gh pr update-branch` ran 108 times by hand. Idea
  0023 covers it.

## Overall read

The harness already has most of the primitives this window needed. The
expensive pattern is bypass: the main session rebuilds them by hand, rather
than any primitive being missing.

The main session merged seven PRs in eight with a bare `gh pr merge` and the
same five chained chores. It ran its own in-process reviews and posted the
verdicts itself, even though `review run` exists. It drove panes with raw
herdr far more often than with the signed `session` commands. The one tool
that changed habits in this window, `harness wait`, did so because it does
strictly more than the hand-built loop.

That points to the rule for the next primitives: fold the chores agents always
chain into the primitive (`judge merge --land`, `orchestrate status`). Then
turn the bypass into an audit-mode signal that names the primitive, rather
than another reminder line, which the flag-on data shows did not move the
share.

The writer side has one real gap: heredoc edits that skip the post-edit hooks.
Idea stamping at spawn is the precondition for measuring any of this per idea.
