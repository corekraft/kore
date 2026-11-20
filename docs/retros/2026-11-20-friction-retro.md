---
summary: Bottleneck and friction retro over the sessions from 2026-11-18T02:13:52Z to 2026-11-20; seven proposals, none filed or applied.
date: 2026-11-20
last-verified: 2026-11-20
---

# Friction Retro 2026-11-20

One of three independent retros over the same window, written through one lens:
where the delivery loop waits, retries or redoes work, and where agents hit
walls. Every item below is a proposal. None is filed as an idea and none is
applied; the main session files ideas once it has all three retros.

## Window and sources

The window runs from the last retrospective, 2026-11-18T02:13:52Z, to about
08:20Z on 2026-11-20. In that time the ledger recorded 252 session starts,
287 pane results (229 done, 58 blocked), 131 merged pull requests, 39 judge
send-backs, 142 judge prechecks and 243 writer `pr check` runs.

The sources were the stage ledger (38,708 events in the window), 123 worktree
transcripts and the main-checkout transcripts, the session records, the
precomputed `retro-scan.json` and `flow-report.json`, and a second
`flow report --json --since 2026-11-18T02:13:52Z` limited to the window. That
second report is needed because the precomputed flow report covers the whole
ledger. Over the whole ledger its writer start-up toil is 41,243 s; in the
window, start-up is small (writer median 6 s, judge 5 s), so that figure comes
from older history and is not a finding here.

The precomputed scan's first run, with `--evidence`, ran out of a 4 GB Node
heap after about 25 s. The scan used here is the main session's rerun without
`--evidence`, so it has no guard-evidence rows. The block classifications below
come from a separate read-only pass over the same transcripts.

A **bottleneck** limits how many ideas get delivered. **Friction** costs time
or tokens without limiting throughput. Findings are ranked by frequency times
cost (wall time, tokens, owner attention).

## Findings

### 1. The precheck accepts a later slice behind an existing flag (bottleneck)

- **Evidence:** 54 of the 100 PRs that ran `pr check` hit `pattern-mismatch`,
  in 118 runs. 68 of 142 judge prechecks failed (48%); idea 0010 expected under
  15%. The three reasons in transcripts:
  - 111 `feature-flagged` with "no flag that is off in an environment overlay"
  - 98 `no-behaviour-change` "changes behaviour in"
  - 54 `dark-launched` with "no flag that is on only in the local overlay"

  50 of the 54 PRs merged anyway, 39 of them while the writer's last `pr check`
  still said `pattern-mismatch`. So the check mostly stops work it then lets
  through. Median open-to-merge was 20 min for these PRs against 13 min for the
  rest. 85 of 151 transcript lines that carry a blocked result name the
  mismatch, across 46 worktree sessions; the ledger records 58 blocked results.
  Citations:
  - Writer `database-certs-local-ca` reported blocked 8 times in 75 minutes,
    each time because its slice reuses the flag an earlier slice added
    (3071a1af:243, 3071a1af:922, 3071a1af:3614).
  - PR #1272 went through four declared patterns in three hours before it
    merged (ledger `precheck` events at 17:18, 19:04, 19:05 and 20:10 on
    2026-11-18).

- **Proposed change:** in the precheck's pattern match
  (`tools/harness/src/judge/verdict.ts`, which `pr check` shares), accept
  `feature-flagged` and `dark-launched` when the diff's code reads a flag that
  already exists in an environment overlay in the required state, not only when
  the diff adds that flag.
- **Hypothesis:** if a later slice behind an existing flag passes the pattern
  match, writers stop reporting blocked on it, and PRs merge sooner because no
  decider or owner has to waive the gate.
- **Metric:** `leadTimePerMergedChange.current`, down, 14 days. It is a shared
  guard metric, so the qualifier will warn; the `pattern-mismatch` share of
  `pr.checked` events is the direct reading.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none. Idea 0010 (writers run the precheck first) shipped
  and now shows writers the mismatch, but they cannot clear it.

### 2. Retro output reaches the queue (bottleneck)

- **Evidence:** all eight harness ideas from the 2026-11-18 retro (0031 to 0038) still have no `issue:` link two days later, and no issue matches their
  titles. Nothing in the loop picks them up, and the metrics they target got
  worse:
  - `guardBlocksByRule.role-read-only` is 240 in the window; 0031 expected
    under 10.
  - `role-worktree` is 43; 0033 expected under 4.
  - `mainSession.signedSendShare` is 0.047; 0035 expected over 0.5.

  `skills/retro/SKILL.md` ends at `idea new` and never runs `idea sync`, the
  command that creates the issue. Its front matter also forks the retro into
  `agent: Explore`, which is read-only. In this window a forked `/retro`
  (agent a78dba81) stopped before its first step: the default scan writes a
  `retro.main-session` ledger event while the `main-session-figures` flag is on,
  and the fork may not write. The skill cannot finish in the agent it names.

- **Proposed change:** in `skills/retro/SKILL.md`, run the retro in a
  write-capable context (drop `agent: Explore`, or name the writer agent), and
  make the last step `idea sync --idea <n>` after each `idea new`, so every
  filed idea gets its issue and enters triage.
- **Hypothesis:** if every retro idea gets an issue when it is filed, retro
  findings enter the ready queue, and the friction they target falls within
  one retro cycle instead of carrying over.
- **Metric:** `ideas.completed`, up, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none.

### 3. The main session waits and relays through harness tools (bottleneck)

- **Evidence:** a single main session dispatches the whole loop. In the window
  it made 1,907 Bash calls, spawned 186 panes and compacted 18 times; a second
  main session compacted 20 times. It polled by hand:
  - 184 raw `gh pr checks` and 204 `sleep` or `until` loops, against 163
    `harness wait` and 60 `session wait`
  - 127 `herdr agent read`, and 112 `herdr agent prompt` against 32
    `session send`
  - 114 battery checks

  The window flow report gives 1,525 foreground poll minutes (11.6 per merged
  change), 7.2 pane reads per finished pane and a signed-send share of 0.047
  (44 signed, 890 raw). 148 of 287 pane results were never noticed by
  `session wait` (`finishDetection.neverNoticed`), so a finished pane waits
  until the main session next reads it. Each poll, read and battery check is a
  turn on one context, which tops out near 480k tokens
  (`mainSessionSetups.largestPrompt`) and compacts often. Citations: session
  112bd8fe, window from line 86921; session 5dfa430d, lines 3521 to 9521.
  This is long-standing: idea 0035 counted 747 raw sends against 4 signed in
  the window before.

- **Proposed change:** an audit-mode guard rule that warns the main session on
  a raw `gh pr checks <n>`, a `sleep` or `until` loop, or a bare
  `herdr agent prompt`, and names the replacement (`pr checks --wait` or
  `harness wait --pr` in the background, `session send`), the way `bare-glob`
  warns today. A `session wait --any` that settles on the first finished pane
  would remove the pane reads.
- **Hypothesis:** if the main session is pointed at the background waits each
  time it starts a foreground poll, its poll minutes and pane reads per merged
  change fall, and it compacts less often.
- **Metric:** `mainSession.foregroundPollMinutesPerMerged`, down, 7 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0035 (no issue). 0019 (#936) and 0021 (#938) have shipped
  and are waiting on their outcome readings.

### 4. Writers check their own prose against the code before `pr open` (friction)

- **Evidence:** send-backs per merged change were 0.267 in the window against
  a trailing 0.065, about four times as many. 29 of the 39 categorised
  send-backs are `wrong-statement`: a GLOSSARY entry, `--help` text, an ADR,
  the contributor guide or the PR body says something the diff does not do.
  Code defects are rare among them. 21 PRs were sent back; #1264 and #1189 six
  times each and #1260 four times, all for prose (ledger `send-back` events,
  for example the one at 2026-11-19 on #1264, head 67915f2). Each round
  relaunches or follows up a writer and re-runs a judge.
- **Proposed change:** add one step to `.claude/agents/writer.md` before
  `pr open`. For every sentence the diff adds to docs, GLOSSARY, usage text,
  ADRs or the PR body that names a number, file, flag, command or behaviour,
  the writer finds the line of code that makes it true, and cuts or fixes any
  sentence without one.
- **Hypothesis:** if writers check each added claim against the code before
  opening the PR, fewer changes are sent back for prose.
- **Metric:** `sendBackCategories.perPrHead.byCategory.wrong-statement`, down,
  14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none. 0026 covers three other mechanical findings, not
  prose claims.

### 5. Read-only roles run loops, substitutions and scratchpad redirects of allowed reads (friction)

- **Evidence:** 240 `role-read-only` blocks in the window, about 107 a day.
  Idea 0013 measured 281 over four days before it shipped (about 70 a day), so
  the rate rose. Judges took 101 and readers and answerers most of the rest.
  Of the 192 blocks matched to their command in transcripts:
  - 38 command or process substitutions
  - 32 `for` loops
  - about 10 redirects of the harness's own read-only output (`judge diff`,
    `flow report --json`) into the session's scratchpad
  - 15 `git -C`, `cat-file`, `ls-tree` or `merge-base`

  About 95 of the 192 ran only allowed reads. The 20 `git fetch` blocks stand,
  because the owner rejected allowing it (#417, item 4d). Citations: 1239f264:143
  (substitution), 0d9daa61:61 (loop), 752b3efe:76 (`judge diff` redirect).

- **Proposed change:** in the role-read-only guard
  (`tools/harness/src/hook/guard-role-writes.ts` and
  `guard-role-protected.ts`), allow a `for` loop or substitution whose every command is on the read
  allowlist, and a redirect whose target is under the session's own scratchpad.
- **Hypothesis:** if loops, substitutions and scratchpad redirects of allowed
  reads pass, judges and readers stop retrying blocked reads, and judge turns
  per PR fall.
- **Metric:** `guardBlocksByRule.role-read-only`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0031 (no issue); 0013 (#801, shipped, waiting on its
  outcome).

### 6. role-worktree judges the paths a command writes, not regex or code text (friction)

- **Evidence:** 43 `role-worktree` blocks; about 23 hit commands that touch
  only the worktree:
  - 13 in-worktree `sed -i` or `perl -pi` edits whose regex slashes read as
    paths (several are the `report.version` bump in flow-report specs)
  - 10 `node -e` scripts or JavaScript fragments read as paths

  This session hit it twice: a regex in `perl -ne` was read as a path, and a
  redirect into its own scratchpad was blocked when the path was written out
  but let through when it was in a variable. Citations: e9b9a272:1153
  (`sed -i`), 578e705e:517 (`toBe` bump), 85c12d89:738 (`vi.mock` read as a
  path). This is long-standing; the 2026-11-14 retro's item 1 found the same
  `node -e` case.

- **Proposed change:** in the role-worktree guard
  (`tools/harness/src/hook/guard-role-delivery.ts`), resolve only the
  redirection targets and the file operands of a known writer command (`sed -i`
  and `perl -pi` file arguments, `>` targets), never the script text. Treat the
  session's scratchpad as inside.
- **Hypothesis:** if the guard reads only the paths a command writes, in-place
  edits and scripts inside the worktree stop being blocked, while real escapes
  still are.
- **Metric:** `guardBlocksByRule.role-worktree`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0033 (no issue); 0022 (#964, shipped, waiting on its
  outcome).

### 7. The retro scan streams its evidence and drops known noise (friction)

- **Evidence:** this covers the scan's own findings, read through this lens.
  - **Memory:** the `--evidence` run ran out of a 4 GB heap
    (`retro-scan.err`), so this retro ran without guard evidence.
    A streaming pass over the same transcripts took about 4 s.
  - **Corrections:** 7 of the 14 repeated-correction clusters cite line 7 of
    writer sessions, which is the spawn brief (for example cluster 90fad6cc
    across 13 sessions, 236b0e80:7), not an owner correction. Cluster c264ae1d
    (5 sessions, for example 9c416044:741) is the main session's own unsigned
    pane messages.
  - **Unused skill and agent:** the scan proposes removing the skill
    `add-policy` and the agent `judgment`. The owner already decided to keep
    `add-policy` (#470, 2026-11-14), and idea 0037 proposed it again.
    `judgment` serves the orchestrator tick (ADR 0121), which logged 9
    `orchestrate` events in the window, so it is unused because the tick is not
    running, not because it is dead.
  - **Promotable audit rules:** none. `bare-glob` was overridden 9 times out of
    99 and `idea-issue-close` 13 times out of 215, so both stay in audit.
- **Proposed change:** in `hook retro-scan`:
  - write `guardEvidence` rows as it reads each transcript, instead of holding
    every transcript in memory
  - skip the first user message of a session that has a spawn brief
  - skip a removal proposal for a subject that has a recorded keep decision
    (a list in `.claude/harness.json`)
- **Hypothesis:** if the scan finishes with evidence and leaves out briefs and
  decided removals, each retro spends its reading on real findings and stops
  re-proposing settled items.
- **Metric:** `retroProposalsDropped`, down, 14 days. No flow metric reads
  scan health directly; this is the nearest.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0037 for the removals (no issue, and it conflicts with
  the #470 decision); none for the rest.

## Also seen, below the cut

- Merge conflicts appeared in 12 of 123 worktree sessions, most often in
  `docs/index.md`, `cli/flow-commands.ts` and `report-merged-changes.spec.ts`.
- `harness --help` prints about 59 KB; the `flow report` summary alone is about
  22 KB, read in full whenever a role looks up a command.
- Haiku writers were blocked in 9 of 30 sessions (0.32) against 3 of 42 for
  Sonnet, mostly from finding 1.
- The window flow report names `await approval` as the bottleneck (99.9% of
  waiting). That stage counts each issue from opening until `ready-for-agent`
  or close, so issues never meant for agents (specs, parents, ideas) fill it.
  Only 6 open issues lack the label today, so the figure does not show a real
  approval queue.

## Overall read

The loop is not short of writers or CI. Writers start in seconds and the
judge's own work is quick. Throughput is limited in three places, each of
which needs a person or the main session to unstick it:

- The precheck's pattern match refuses legitimate later slices, and the main
  session or the owner then waives it by hand.
- One main session notices, reads and relays every pane by polling a context
  that compacts many times a day.
- The retro's own output never enters the queue, so the guard friction it
  measures carries from one retro to the next, unchanged or worse.

The rest is friction: prose send-backs, and read-only and worktree guard blocks
on legitimate reads and edits. It costs judge and writer turns but does not
stop delivery. Three of the seven findings were already filed on 2026-11-18 and
never got an issue, so the cheapest gain is finding 2: once retro ideas reach
the queue, findings 3, 5 and 6 are already written.
