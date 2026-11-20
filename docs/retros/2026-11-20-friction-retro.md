---
summary: Throughput-limit and cost retro over the sessions from 2026-11-18T02:13:52Z to 2026-11-20, revised after its grill; four new ideas, three tickets and three folds into ideas 0031, 0033 and 0035, none filed or applied.
date: 2026-11-20
last-verified: 2026-11-20
---

# Friction Retro 2026-11-20

One of three independent retros over the same window, written through one lens:
where the delivery loop waits, retries or redoes work, and where agents hit
walls. It was grilled in 15 questions (outcome kept outside the repository), and
the owner has since decided every question the grill left open. Every item below
is a proposal. None is filed and none is applied; the main session files them.

## Window and sources

The window runs from the last retrospective, 2026-11-18T02:13:52Z, to an as-of
time of about 08:20Z on 2026-11-20. The figures are a reading at that time and
are not meant to reproduce to the digit: the grill's own rerun of the window
flow report drifted slightly from them (noted where it matters).

Each count is labelled by its source:

- **(ledger)**: events in `.kore/state/ledger.jsonl` inside the window (38,708
  events).
- **(window report)**: `harness flow report --json --since 2026-11-18T02:13:52Z`.
  The precomputed flow report covers the whole ledger, so it was not used for
  window figures. Its writer start-up toil (41,243 s) comes from older history;
  in the window, start-up is small (writer median 6 s, judge 5 s, ledger).
- **(transcripts)**: a read-only pass over 123 worktree transcripts and the
  main-checkout transcripts. These counts cannot be rebuilt from the flow
  report, and the grill could not verify them.
- **(scan)**: `retro-scan.json`, from the main session's rerun of
  `hook retro-scan --strict` without `--evidence`. The first run, with
  `--evidence`, ran out of a 4 GB Node heap, so the scan has no guard-evidence
  rows.
- **(grill)**: figures the grill reproduced from its own window flow report.

In the window (ledger): 252 session starts, 287 pane results (229 done, 58
blocked), 131 merged pull requests, 39 judge send-backs, 142 judge prechecks
and 243 writer `pr check` runs.

The glossary already defines Bottleneck and Friction in other senses, so this
retro uses its own two labels:

- A **limit on throughput** limits how many ideas get delivered.
- A **cost without a limit** costs time or tokens and does not limit throughput.

Findings are ranked by frequency times cost (wall time, tokens, owner
attention).

## Owner decisions

The owner decided these on 2026-11-20 in the main session. They are recorded
here as decided, not open:

- **The guard freeze stays** (ADRs 0091, 0101, 0123). There is no new guard
  rule, audit mode included. Finding 3 proposes none.
- **The orchestrator tick should run.** Anything this retro tied to the tick,
  such as the `judgment` agent in finding 7, waits on the tick starting, not on
  a decision.
- **No loop or substitution parsing in the read-only guard.** Finding 5 keeps
  only the scratchpad-redirect quick fix to the existing rule, so no ADR
  refining 0091 or 0101 is needed.
- **No `--override` or `--accept` on `judge merge` in this retro.** Finding 1
  proposes no waiver path.

## What is filed, in order

- **Tickets:** (T1) the prerequisite flow metrics, (T2) the streaming bug in
  the retro scan, (T3) the `await approval` reading.
- **New ideas:** finding 1 (after T1), finding 2, finding 4, and the idea
  half of finding 7. That is four, within ADR 0118's cap of five, which binds
  only the automatic retro.
- **Folds into existing ideas:** finding 3 into 0035, finding 5 into 0031,
  finding 6 into 0033.
- **Prerequisite ticket T1** (`no-behaviour-change`; ADR 0101 allows it): add
  flow metrics for
  - (a) the share of `pr.checked` events naming `pattern-mismatch`, written by
    `cli/pr-check-command.ts` and so independent of `judge/verdict.ts`
  - (b) the writer blocked share per tier. Today `writerCost.current` carries a
    `status` key, so the metric walk stops there and no per-tier path exists.
  - (c) the share of filed ideas that have an issue
  - (d) a scan-health reading

  They stay guard metrics until one idea owns them. Findings 1, 2 and 7 are
  filed after T1 lands (ADR 0119, Consequences).

## Findings

### 1. The precheck accepts a later slice behind an existing flag (limit on throughput)

- **Evidence:**
  - 68 of 142 judge prechecks failed, 48% (ledger); idea 0010 expected under
    15%.
  - 54 of the 100 PRs that ran `pr check` hit `pattern-mismatch`, in 118 runs
    (transcripts). The reasons appear on 111 transcript lines for
    `feature-flagged` with no new flag that is off in an overlay, 98 for
    `no-behaviour-change` that "changes behaviour", and 54 for `dark-launched`
    with no new local-only flag. These count lines, not runs, so they exceed 118.
  - 50 of those 54 PRs merged (transcripts). Median open-to-merge was 20 min
    against 13 min for the rest (ledger).
  - 85 of 151 transcript lines carrying a blocked result name the mismatch,
    across 46 worktree sessions (transcripts).
  - Writer `database-certs-local-ca` reported blocked 8 times in 75 minutes
    (ledger), each time because its slice reuses a flag an earlier slice added
    (3071a1af:243, 3071a1af:922, 3071a1af:3614).
  - PR #1272 declared four patterns before it merged (ledger `precheck` events
    at 17:18, 19:04, 19:05 and 20:10 on 2026-11-18).

  A first draft read 39 merges "while the last `pr check` still said
  mismatch" as merges past the gate. That reading is withdrawn. The merge tool
  re-runs the precheck, and a failing `pattern-match` item makes the report
  not ok, so those are more likely stale checks taken before a redeclared
  pattern. No ledger event shows a waiver. The expected gain is therefore
  smaller than first claimed.

- **Proposed change:** `judge-pattern-match` is an enforced checklist item in
  `.claude/guardrails.yaml`, owned by `tools/harness/src/judge/checklist.ts`;
  `judge/verdict.ts` builds the verdict. Accept `feature-flagged` and
  `dark-launched` when the diff's code reads a flag that already exists in an
  environment overlay in the required state. As a loosened guardrail it lands
  in audit mode (ADR 0080), and enforcing it goes through `guardrail request`
  and `guardrail activate`. A cheaper step comes first, as guidance in
  `.claude/agents/writer.md`: re-run `pr check` after the last body edit, so a
  redeclared pattern is not reported on a stale check.
- **Hypothesis:** if a later slice behind an existing flag passes the pattern
  match, writers stop reporting blocked on it.
- **Metric:** the T1 `pr.checked` pattern-mismatch share, down, 14 days. No
  valid primary exists today:
  `sendBackCategories.perPrHead.byCategory.pattern-mismatch` is 2 events in the
  window (grill) against 68 failed prechecks, and the lead-time metric is a
  shared guard metric.
- **Safety pattern:** `feature-flagged`. It is a guardrail change: the item
  lands in audit and a person activates it. It is not `no-behaviour-change`.
- **Already filed:** none. Idea 0010 shipped and now shows writers the
  mismatch, but they cannot clear it. File after T1.

### 2. Every filed retro idea gets its issue (limit on throughput)

- **Evidence:**
  - All eight harness ideas from the 2026-11-18 retro (0031 to 0038) still have
    no `issue:` line in their files, and no issue matches their titles.
  - `approver.ts` and `guardrail/request.ts` refuse an idea with no issue
    (verified in the grill), so these ideas cannot move.
  - The metrics they target are unchanged or worse:
    `guardBlocksByRule.role-read-only` is 240 (window report, matched by the
    grill) where 0031 expected under 10; `role-worktree` is 43 (window report)
    where 0033 expected under 4; `mainSession.signedSendShare` is 0.047 (window
    report; 0.049 in the grill) where 0035 expected over 0.5.
  - Neither filing path syncs. `skills/retro/SKILL.md` ends at `idea new`, and
    the automatic filer `orchestrator/retro-filing-cli.ts` (ADR 0118) records
    `idea.filed` without running `idea sync`.
  - In the author's reading, a forked `/retro` in this window (agent a78dba81)
    stopped before its first step because the default scan writes a ledger
    event and the fork is read-only. The grill could not verify this, and the
    proposal does not depend on it.
- **Proposed change:** make filing include `idea sync` in both places:
  - in the automatic filer, behind `automatic-retro`, which stays off; turning
    it on stays under ADR 0077
  - for the manual skill, as a separate step the main session runs, with the
    manual retro run in the main session rather than the fork

  The retro agent stays read-only (ADRs 0117 and 0118).

- **Hypothesis:** if every retro idea gets an issue when it is filed, retro
  findings enter triage and the ready queue instead of carrying over to the
  next retro.
- **Metric:** the T1 share of filed ideas that have an issue, up, 14 days. It
  must not be written by the filer itself (ADR 0119). Ideas from the manual
  path may carry no `idea.filed` event, so read each idea file's `issue:` line,
  or have the manual path record the event. `ideas.completed` is rejected: it
  covers the whole ledger and many ideas move it.
- **Safety pattern:** `feature-flagged` (the tool half sits behind
  `automatic-retro`, which is off).
- **Already filed:** none. File after T1.

### 3. The main session still polls and relays by hand (limit on throughput; folds into 0035)

- **Evidence:**
  - The window report gives 1,525 foreground poll minutes, 11.6 per merged
    change (grill 11.3); 7.2 pane reads per finished pane (grill 6.9); and a
    signed-send share of 0.047 (44 signed, 890 raw; grill 0.049).
  - 148 of 287 pane results were never noticed by `session wait`
    (`finishDetection.neverNoticed`, window report).
  - The main session behind most of the loop (session 112bd8fe, from line 86921) made 1,907 Bash calls, spawned 186 panes and compacted 18 times; a
    second main session (5dfa430d) compacted 20 times (transcripts).
  - Session 112bd8fe also ran 184 raw `gh pr checks` and 204 `sleep` or
    `until` loops, against 163 `harness wait` and 60 `session wait`; 127
    `herdr agent read`; and 112 `herdr agent prompt` against 32
    `session send` (transcripts).
  - This is long-standing: idea 0035 counted 747 raw sends against 4 signed in
    the window before.
- **Proposed change:** none new. ADR 0123 settles that the main session waits
  and sends through harness tools with no guard rule, and the owner kept the
  guard freeze. `harness wait` already settles on the first of any mix of
  `--pr` and `--session`, so no new tool is needed. Add this evidence to idea
  0035 and file nothing more until the outcomes of 0019 (#936) and 0021 (#938)
  are read.

  The open question for that reading is why the main session still prefers
  raw `gh pr checks` and raw `herdr` commands, and why 148 results went
  unnoticed. It is not to be answered with a hook that warns, because that is
  a guard.

- **Hypothesis:** as 0035 states it.
- **Metric:** 0035's primary, `mainSession.signedSendShare`, up, 14 days.
  0019 already owns `mainSession.foregroundPollMinutesPerMerged`, so a new idea
  on it would open a second window on a shared primary.
- **Safety pattern:** as 0035 (`no-behaviour-change`).
- **Already filed:** 0035 (no issue yet; it gets one through finding 2); 0019
  (#936) and 0021 (#938) have shipped and wait on their outcomes.

### 4. Writers check their own prose against the code before `pr open` (cost without a limit)

- **Evidence:**
  - Send-backs per merged change were 0.267 in the window against a trailing
    0.065 (window report; grill 0.259, trailing matched). This compares total
    rates only: the `wrong-statement` category has no baseline before
    2026-11-17 (#1120), because categories became required on 2026-11-16
    (#884).
  - In the window, 29 of 39 categorised send-back events are
    `wrong-statement` (ledger); counted once per PR head, it is 28 of 35
    (grill). In each, a GLOSSARY entry, `--help` text, an ADR, the contributor
    guide or the PR body says something the diff does not do.
  - #1264 and #1189 account for 12 of those send-backs (ledger, for example
    the one on #1264 at head 67915f2).
  - Confidence in the cause is low. The tier split (Sonnet 9 of 32 merged,
    Haiku 11 of 29, grill) rules out a Haiku effect. A stricter judge, a change
    in what gets reviewed, or a run of docs-heavy PRs is not ruled out.
- **Proposed change:** one step in `.claude/agents/writer.md`, which is not a
  guardrail, before `pr open`. For every sentence the diff adds to docs,
  GLOSSARY, usage text, ADRs or the PR body that names a number, file, flag,
  command or behaviour, the writer finds the line of code that makes it true,
  and cuts or fixes any sentence without one.
- **Hypothesis:** if writers check each added claim against the code before
  opening the PR, fewer changes are sent back for prose.
- **Metric:** `sendBackCategories.perPrHead.byCategory.wrong-statement`, read
  as an absolute count per merged change, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none. No open idea names `wrong-statement`; 0026 moves
  other categories.

### 5. Read-only roles may redirect allowed reads into their own scratchpad (cost without a limit; folds into 0031)

- **Evidence:**
  - 240 `role-read-only` blocks in the window, about 107 a day (window report,
    matched by the grill). Idea 0013 measured 281 over four days before it
    shipped, about 70 a day. Judges took 101 (ledger).
  - Of the 192 blocks matched to their command (transcripts): 38 command or
    process substitutions, 32 `for` loops, about 10 redirects of the harness's
    own read-only output (`judge diff`, `flow report --json`) into the
    session's scratchpad, 15 `git -C`, `cat-file`, `ls-tree` or `merge-base`,
    and 20 `git fetch`.
  - Citations: 752b3efe:76 (a `judge diff` redirect), 1239f264:143 (a
    substitution), 0d9daa61:61 (a loop).
- **Proposed change:** only the quick fix to the existing rule (ADR 0091):
  allow a redirect whose target is under the session's own scratchpad. The
  owner decided against teaching the guard to evaluate loops and
  substitutions. The 20 `git fetch` blocks stand (owner rejected, #417 item
  4d). The fix loosens an enforced guardrail, so it needs:
  - the ADR 0119 corpus, built from known-bad cases in the block rows
  - a transcript replay (`guardrail replay`) checked by a reader pane
  - `guardrail request`, then `guardrail activate` by a person
- **Hypothesis:** if redirects of allowed reads into the session's scratchpad
  pass, those blocks (about 10 in 192) stop; the other blocks stay.
- **Metric:** 0031's primary, `guardBlocksByRule.role-read-only`, down, 14
  days.
- **Safety pattern:** `feature-flagged` (a loosened guardrail lands in audit,
  ADR 0080).
- **Already filed:** 0031 (no issue yet); 0013 (#801, shipped, waits on its
  outcome).

### 6. role-worktree checks only the paths a command writes (cost without a limit; folds into 0033)

- **Evidence:**
  - 43 `role-worktree` blocks in the window (window report). About 23 of them
    hit commands that touch only the worktree (transcripts):
    - 13 in-worktree `sed -i` or `perl -pi` edits whose regex slashes read as
      paths, several of them the `report.version` bump in flow-report specs
    - 10 `node -e` scripts or JavaScript fragments read as paths
  - This session hit it twice: a regex in `perl -ne` was read as a path, and a
    redirect into its own scratchpad was blocked when the path was written out
    but allowed when it sat in a variable.
  - Citations: e9b9a272:1153 (`sed -i`), 578e705e:517 (a `toBe` bump),
    85c12d89:738 (`vi.mock` read as a path).
  - This is long-standing: item 1 of the 2026-11-14 repo retro found the same
    `node -e` case.
- **Proposed change:** in `tools/harness/src/hook/guard-role-delivery.ts`,
  resolve only redirection targets and the file operands of known writing
  commands, never the script text. Treat the session's scratchpad as inside
  the worktree. This narrows an existing rule, so it is a quick fix under
  ADR 0091. `role-worktree` is enforced in the inventory, so it still needs the
  corpus, the replay and the guardrail path, as in finding 5. It overlaps idea
  0022, which has shipped and waits on its outcome.
- **Hypothesis:** if the guard reads only the paths a command writes, in-place
  edits and scripts inside the worktree stop being blocked, while real escapes
  still are.
- **Metric:** 0033's primary, `guardBlocksByRule.role-worktree`, down, 14 days.
- **Safety pattern:** `feature-flagged` (a loosened guardrail lands in audit,
  ADR 0080).
- **Already filed:** 0033 (no issue yet); 0022 (#964, shipped, waits on its
  outcome).

### 7. The retro scan streams its evidence and leaves out known noise (cost without a limit; split)

- **Evidence:** this covers the scan's own findings, read through this lens.
  - **Memory:** the `--evidence` run ran out of a 4 GB heap
    (`retro-scan.err`), so this retro ran without guard evidence. A streaming
    read-only pass over the same transcripts took about 4 s.
  - **Corrections:** 7 of the 14 repeated-correction clusters cite line 7 of
    writer sessions (scan), which is the spawn brief, not an owner correction.
    For example, cluster 90fad6cc spans 13 sessions (236b0e80:7). Cluster
    c264ae1d (5 sessions, for example 9c416044:741) is the main session's own
    unsigned pane messages.
  - **Unused skill and agent:** the scan proposes removing the skill
    `add-policy` and the agent `judgment` (scan). The owner decided to keep
    `add-policy` (#470, 2026-11-14), yet idea 0037 proposed removing it again.
    `judgment` is kept by the accepted ADR 0121; it is unused because the tick
    is not running yet (9 `orchestrate` events, window report), and the owner
    has decided the tick should run.
  - **Promotable audit rules:** none (scan). `bare-glob` was overridden 9
    times in 99 and `idea-issue-close` 13 times in 215, so both stay in audit.
- **Proposed change:** split in two.
  - Ticket T2, a bug: `hook retro-scan --evidence` writes its `guardEvidence`
    rows as it reads each transcript instead of holding every transcript in
    memory. It gets a test and has no hypothesis.
  - An idea: the scan skips the first user message of a session that has a
    spawn brief when counting corrections, and skips a removal proposal for a
    subject on a keep list in `.claude/harness.json`.

  Separately, amend 0037 to drop `add-policy` before it gets an issue.

- **Hypothesis:** if the scan leaves out spawn briefs and decided removals,
  each retro spends its reading on real findings and stops re-proposing
  settled items.
- **Metric:** the T1 scan-health reading, direction set by T1, 14 days.
  `retroProposalsDropped` is rejected: it is a cap counter (ADR 0118), it is 0
  in the window, and it cannot go down. Whether events the scan writes itself
  can feed the reading is for T1 to settle.
- **Safety pattern:** `no-behaviour-change` (the ticket and the idea).
- **Already filed:** 0037 for the removals (no issue yet; amend it); none for
  the rest. File the idea after T1.

## Also seen, below the cut

- **The `await approval` reading is wrong; it becomes ticket T3.** The window
  report names it the largest waiting stage (99.9%). That stage counts each
  issue from opening until `ready-for-agent` or close, so issues never meant
  for agents (specs, parents, ideas) fill it. Only 6 open issues lacked the
  label at the as-of time. T3 leaves those issues out of the stage
  (`no-behaviour-change`; a schema change bumps `report.version`).
- **Merge conflicts** appeared in 12 of 123 worktree sessions, most often in
  `docs/index.md`, `cli/flow-commands.ts` and `report-merged-changes.spec.ts`
  (transcripts).
- **Help text is large.** `harness --help` prints about 59 KB, and the
  `flow report` summary alone is about 22 KB, read in full whenever a role
  looks up a command.
- **Haiku writers were blocked more often**: 9 of 30 sessions (0.32) against
  3 of 42 for Sonnet (window report), much of it from finding 1. T1(b) makes
  this readable per tier.

## Overall read

The loop is not short of writers or CI: writers start in seconds and the
judge's own work is quick. Throughput is limited in three places. The
precheck's pattern match refuses legitimate later slices, and writers stop on
it, although the gain from fixing it is smaller than the first draft claimed.
One main session notices, reads and relays every pane by polling one context
that compacts many times a day; the fix for that is already decided (ADR 0123)
and waits on the outcomes of 0019 and 0021, not on a new rule. Retro ideas never
get an issue, so the guard costs they measure carry from one retro to the next,
unchanged or worse.

The rest costs time without limiting throughput: prose send-backs, and guard
blocks on reads and edits that only touch the role's own space. With the guard
freeze and the no-parsing decision in place, the guard fixes shrink to two
narrow quick fixes. The cheapest gain is still finding 2: three of the seven
findings fold into ideas filed on 2026-11-18 that never got an issue, and the
new ideas wait on one metrics ticket, T1.
