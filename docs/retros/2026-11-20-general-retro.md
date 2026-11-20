---
summary: General retro of 2026-11-18 to 2026-11-20, revised after its grill and the owner's decisions; no new idea, four tickets plus a writer.md guidance line, and evidence added to ideas 0038, 0019, 0035, 0031, 0013, 0033, 0022 and 0012.
date: 2026-11-20
last-verified: 2026-11-20
---

# General Retro 2026-11-20

This retro has no narrower lens. It asks how delivery went, what to keep, and
what cost the most time, tokens or owner attention.

A griller and an answerer reviewed it in 15 questions. The owner then decided
every open question (see Owner decisions). This version applies every verdict
and evidence correction from that grill. It files no new idea. What it
proposes:

- four tickets: findings 1, 3, 5 and 7, plus the scan-noise ticket under Smaller signals;
- one guidance line in `.claude/agents/writer.md` (finding 6);
- evidence and status for existing ideas: 0038, 0019, 0035, 0031, 0013 and 0012, plus 0033 and the 0022 re-check.

This stays within the ADR 0118 cap.

## Window and sources

- Window: 2026-11-18T02:13:52Z to 2026-11-20T08:30Z.
- Every count is labelled by its source, and counts from different sources are never added together.

The sources:

- **[ledger]:** in-window events of `.kore/state/ledger.jsonl`, 39,099 events in total:
  - 196 `session.launch`, 133 `pr.opened`, 98 `pr.linked`, 131 `pr.merged`;
  - 39 `send-back`, 64 `pane.stalled`, 18 `session.compacted`;
  - 10 `outcome`, 8 `flag.activated`;
  - 297 `guard.block`: 240 `role-read-only`, 46 `role-worktree`, 5 `role-no-merge`, 3 `no-verify`, and 1 each of `kubectl-context`, `helm-context` and `destructive`.
  - Token figures are cumulative `token.split` deltas per session and model, taken across the window's start.
- **[sessions]:** 190 records in `.kore/state/sessions/*.json` created in the window: 98 judges, 73 writers, 10 readers and 9 principles-review panes.
- **[scan]:** the precomputed `retro-scan.json` (`hook retro-scan --strict`), 250 sessions. It counts blocks in transcripts, so its figures differ from [ledger]. For example, it counts 167 `role-read-only`, 13 `unquoted-glob` and 11 `equals-word`.
- **[fork]:** a `/retro` skill fork run with `--evidence`. It sampled 20 blocks per rule and cites session:line.
- **[flow]:** the precomputed `flow-report.json` (`flow report --json`). It is unscoped, and its per-merged-change figures read a trailing 7 days.
- **[main]:** tool calls in the main-session transcript `112bd8fe` from line 86887, where the window starts.
- **[gh]:** GitHub, where 132 PRs merged in the window.

## Owner decisions (2026-11-20)

The owner decided every question the grills left open. Each is recorded here as
decided:

1. **The guard freeze stays** (ADRs 0091, 0101, 0123). There is no new guard rule, audit mode included: no warning on raw herdr sends, on a bare `gh pr merge`, or on heredoc edits.
2. **The orchestrator tick should run.** Findings that were blocked on the tick decision now wait on the tick starting, not on a decision (finding 2).
3. **Compaction caps go as recommended.**
   - E2 and E1 are not reordered ahead of E3 on the dollar case; they are filed in sequence after E3, as idea 0038 already says.
   - The owner sets the cap value after the baseline (finding 1).
4. **No `--override` or `--accept` on `harness judge merge` inside this retro.** If it is wanted later, it comes as a separate proposal with its own ADR (finding 3).
5. **The read-only guard gets no parsing of loops or command substitutions.** Its only change is a quick fix to the existing rule for redirects into the scratchpad (finding 5).
6. **Opus for the 2026-11-20 retro writers was a special case the owner chose.** It is not an issue, and no saving is proposed for it.
7. **Judge effort goes to the decider with data.**
   - The choice is between `medium` and `high`.
   - The ADR refining 0124 is held until the 5a rerun shows the double count.
   - `review post --none` refusing when no review is recorded for the head is accepted as a tool rule, not a guard.

## What worked and should be kept

- **Fast delivery, with owner attention routed elsewhere.**
  - [ledger]: 131 merges in about 54 hours.
  - [flow] `leadTimePerMergedChange`: the median is 758 s, against a trailing 738 s.
  - Send-backs: 0.11 per merged change ([flow] `sendBacksPerMergedChange`).
  - Owner questions: [flow] `ownerQuestions.questions` is 0, but it counts only `owner.asked`.
    - Beside it, `ownerRoutes` shows 3 owner routes for reserved categories and 0 to the advisor.
    - `waitingOnPerson` records no questions.
    - `outcomes.ownerMinutes` reads 252 minutes over 560 merged changes, 0.45 per merged change, as an upper bound.
    - Zero questions means recommended decisions went to the advisor, and reserved ones went by delegation. It does not mean the owner was never needed: finding 3 shows the owner posting merge acceptances by hand.
  - The advisor made 10 decisions and none was overturned ([flow] `advisorQuality`).
- **Interim reading on writer tiers.**
  - [flow] `writerArms.overall` puts Haiku at 2.65 and Sonnet at 3.20 all-in per merged change, at effort `high`, the window effort taken as the most common.
    - The difference is -0.55, with an interval of -1.11 to -0.02, which barely excludes zero.
    - Haiku's blocked share is three times Sonnet's (0.33 against 0.10).
    - The report states no winner, margin or verdict.
  - Excluded launches: `differentEffort` 0, `missingEffort` 7, `notRandomized` 16; 56 changes are unlabelled.
  - The 41 Sonnet writers launched as overrides ([ledger] `session.launch`) are outside the arms.
  - No change to the writer default is asked for.
- **Live proof gates activation.** Each of the 8 [ledger] `flag.activated` events follows a recorded `outcome` event.
- **The 2026-11-14 zsh and `cd` fixes landed.**
  - [scan]: `unquoted-glob` fell from 264 blocks to 13 per window, and `equals-word` from 99 to 11. The 264 and 99 are from the 2026-11-14 retro's scan.
  - [fork]: in its sample, `cd` moves inside the worktree no longer make up most `role-worktree` blocks.

## The findings

Ranked by frequency times cost, most expensive first. Every metric window is 14
days, except per-merged-change writer figures, which use 7 days. Each existing
idea keeps its own window.

## 1. Record the main session's context evidence under idea 0038, and stream the retro scan

- **Verdict:** changed. The proposal is now a setting, folded into idea 0038. The stop-hook handover and the target of falling below writing cost are dropped.
- **Evidence:**
  - [ledger]: main sessions carry 826M of the window's 1,987M cache-read tokens (42%).
    - `112bd8fe` alone carries 704M over 2,871 requests, about 245k tokens per request.
    - Its largest prompt is 480,379 tokens.
  - [flow] `tokensByStagePerMergedChange.current.perMerged`: the `orchestrate` field is 149,885 tokens, against 116,349 for `write`.
    - `writerCost.current.orchestrate` prices that bucket at 931 dollars, against 3.32 for all judges.
  - [flow] `mainSessionSetups.compactionCap` is null, so every stretch reads `not set`.
  - [main]: in the window the session was re-prompted 226 times by stop-hook feedback (first at `112bd8fe:87533`) and woken 98 times by a periodic timer (`112bd8fe:87340`).
    - The re-prompting stop hook is not in this repository: `feedback.ts` only records stops and reads the cap for reporting.
  - [fork]: `retro-scan --evidence` ran out of memory at the default heap on the 197 MB, 117,404-line transcript. `retro-transcript.ts` reads the whole file at once.
- **Proposed change:**
  - (a) Add this evidence to idea 0038's record.
    - Following owner decision 3, E2 (early compaction) and E1 (Haiku under the cap) stay filed in sequence after E3's outcome.
    - The owner sets `cost.compactionCap` in `.claude/harness.json` after the baseline.
    - The window opens after 0038's control window and after the writer-tier window closes (ADR 0119).
  - (b) A separate developer-tool ticket: `retro-transcript.ts` reads line by line, and drops events before `--since` as it reads.
- **Hypothesis:** as idea 0038 states, Main-session cost per merged change falls when no session polls. A compaction cap set after the baseline is that sequence's next arm, not a new hypothesis.
- **Metric:** idea 0038's `writerCost.current`, read as the `orchestrate` bucket per merged change, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0038.

## 2. Status of ideas 0019 and 0035: the wait tools shipped, and adoption waits on the orchestrator tick starting

- **Verdict:** changed. This is a status report, not a new idea. The proposed guard on raw `herdr agent prompt` is dropped (owner decision 1).
- **Evidence:**
  - All three flags turned on in `local` before this window opened, so the whole window comes after activation ([ledger] `flag.activated`; `infra/environments/local/environment.yaml`):
    - `orchestrator-tick` at 2026-11-17T14:13Z;
    - `main-session-wait` at 2026-11-18T01:54Z;
    - `signed-main-sends` at 2026-11-18T02:03Z.
  - [main]:
    - 343 `sleep` calls (`112bd8fe:86967`, `112bd8fe:89622`, `112bd8fe:93189`);
    - 702 `gh pr view` and 277 `gh pr checks`, against 258 `harness wait` and 61 `harness session wait`;
    - 122 raw `herdr agent prompt` against 34 `harness session send`.
  - [scan], across 48 main sessions: 1,525 foreground poll minutes, 891 pane reads, and 890 raw sends against 44 signed.
  - [flow] `finishDetection`: of 552 results, 365 went undetected and 308 were never noticed.
  - Idea 0035 was filed on 2026-11-18 with 747 raw sends against 4 signed. The signed share is still far below its target of 0.5.
- **Proposed change:** none new. Record this reading on ideas 0019 and 0035. The owner has decided the orchestrator tick should run (decision 2), so both ideas' adoption waits on the tick starting, not on a decision.
- **Hypothesis:** as filed. Idea 0019 says poll minutes per merged change fall when waits leave the main session's turn. Idea 0035 says the signed send share rises.
- **Metric:** idea 0019's `mainSession.foregroundPollMinutesPerMerged`, down, 14 days. Idea 0035's `mainSession.signedSendShare`, up, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0019 and 0035. 0038 is related.

## 3. Measure admin merges and unpinned merges before proposing anything about them

- **Verdict:** changed. A measurement ticket comes first. `--accept` on `harness judge merge` and a guard on bare `gh pr merge` are both out of this retro (owner decisions 1 and 4).
- **Evidence:**
  - [gh]: of 132 PRs merged in the window, 78 had review decision `REVIEW_REQUIRED` at merge.
  - [main]: 106 tool calls ran `gh pr merge`, against 15 that ran `harness judge merge`.
    - 64 used `--admin`, and every one of those also passed `--match-head-commit`.
    - 41 had no `--match-head-commit` and no `--admin`.
    - So the two sets do not overlap.
    - Examples: `112bd8fe:99320`, `112bd8fe:102802`.
  - An admin merge with a pinned head, after advisor or owner acceptance, is the sanctioned path. The finding is the 41 unpinned merges, and any acceptance that was never recorded.
  - [fork]: the owner had an agent post merge acceptances by hand for pattern mismatches (`112bd8fe:99161`, `5dfa430d:7217`).
  - `reviewRounds.unlinked.reviewCoverage` is the row for PRs with no linked tier, so it cannot measure any of this.
- **Proposed change:**
  - A ticket that adds two separate readings to `flow report`: admin merges and unpinned merges, each from a recorded merge event.
  - Any change to the merge path comes later, as its own proposal with its own ADR, once a baseline exists.
  - Proposed glossary term, not written: **Admin merge**, a merge made with `gh pr merge --admin` outside `harness judge merge`. It is a reading, never a violation by itself.
- **Hypothesis:** none yet. The ticket supplies the baseline a later proposal needs.
- **Metric:** none in the flow report today. The ticket adds it.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none. Idea 0018 is related.

## 4. Find why opened PRs did not link (a question for idea 0012 and ADR 0126)

- **Verdict:** changed. Refusing a spawn with no idea is dropped: it would reverse ADR 0126, which reads the idea from the PR on `pr.linked`, and the warn-and-start in `spawn-check.ts`.
- **Evidence:**
  - [ledger] `spawn.unstamped` by role: 72 writers, 99 judges, 14 principles-review panes and 10 readers. Judges and readers serve no idea, so only the writers count: 72 of the 73 writer launches in [sessions].
    - `--no-idea <reason>` already exists, and its usage text states it.
  - [ledger]: 133 `pr.opened` against 98 `pr.linked` in the window, so 35 opened PRs never linked.
  - [flow] `writerCost.current.unjoinable` is 480 of 560 merged changes.
- **Proposed change:** add a question to idea 0012 and ADR 0126: why did `harness pr open` not record `pr.linked` for those 35 PRs? Check the 133 `pr.opened` events against `pr.linked` before proposing a fix.
- **Hypothesis:** as filed in idea 0012: if every loop event carries its idea and stage, the attributed share rises.
- **Metric:** idea 0012's `attribution.withIdeaAndStage`, up, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0012.

## 5. Name `harness judge diff` in principles-review, and add the scratchpad-redirect fix to idea 0031

- **Verdict:** changed and split. One documentation ticket, plus a status note on ideas 0031 and 0013. There is no new parsing of loops or command substitutions (owner decision 5).
- **Evidence:**
  - [ledger] `role-read-only` blocks: 240 in total.
    - By agent name: 101 judges, 74 subagents of `112bd8fe`, 32 answerers and 16 readers.
    - [scan] counts 167 in transcripts.
  - Blocked commands, tallied from in-window tool results:
    - 27 `git fetch -q` (`1239f264:120`, `a1631117:71`);
    - 22 `gh pr diff N` redirected into a scratch file (`112bd8fe/subagents/agent-a41c1fe04d9b2adb9:25`, `agent-a4308e7ca66680b04:15`).
  - [fork], sampling 20 blocks: 6 `for` loops, 5 command substitutions and 4 stderr redirects.
  - `.claude/agents/principles-review.md:12` still says `git diff main...HEAD` and names no fetch-free diff.
  - `reader.md` reads files, not PR diffs, so it needs no edit.
  - `git fetch` stays refused (#417, item 4d).
- **Proposed change:**
  - (1) A documentation ticket: `.claude/agents/principles-review.md` names `harness judge diff <pr>` for a PR diff.
  - (2) Add to idea 0031: its build is limited to a quick fix in the existing rule in `guard-role-allow.ts`. That fix allows a redirect into the session's own scratchpad. There is no parsing of loops or substitutions.
- **Hypothesis:** as filed in idea 0031: if the common read forms pass, read-only panes stop retrying blocked commands.
- **Metric:** idea 0031's `guardBlocksByRule.role-read-only`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0031, and 0013 (#801).

## 6. Guard false positives on script and query text: evidence for 0033 and the 0022 re-check

- **Verdict:** dropped as a proposal and kept as evidence.
  - It re-proposed the role-worktree half of #845 (PR #902), closed wontfix on 2026-11-17 after a judge pass found two bypasses.
  - The role-no-merge half is parked until 2026-11-30, with a fixed re-check (idea 0022).
- **Evidence:**
  - [ledger]: 46 `role-worktree` blocks.
  - [fork], sampling 20 of them: 15 were legitimate.
    - 12 were `sed -i` or `perl -pi` substitutions whose `/` delimiters were read as paths (`578e705e:517`, `91bfc793:983`).
    - 2 were `node -e` bodies (`c66d13ae:127`).
  - [fork]: `role-no-merge` matched "flag activate" inside a script (`9c2180af:164`).
  - In this session, `role-no-merge` blocked a read-only `gh api graphql` query whose text contained the word "merged".
- **Proposed change:**
  - Attach this evidence to idea 0033 and to the 0022 re-check.
  - The one action is guidance: `.claude/agents/writer.md` has no line telling writers to edit with the Edit tool instead of `sed -i`, so add one.
  - Quoted query arguments are not proposed as data to skip, because 0022 limits allowed data to `gh pr create`, `gh issue ...` and `harness pr open`.
- **Hypothesis:** if writers edit with the Edit tool, `sed -i` and `perl -pi` blocks stop.
- **Metric:** idea 0033's `guardBlocksByRule.role-worktree`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** 0033, and 0022.

## 7. Give every harness idea its issue when it is filed

- **Verdict:** changed. Running `idea sync` from `idea new` becomes a developer-tool ticket. The `ready-for-agent` labelling is dropped: that label means fully specified (`docs/agents/triage-labels.md`), and an idea issue is not a spec.
- **Evidence:**
  - [repo]: 11 of 51 idea records have no `issue:` line, including 0031 to 0037 from the 2026-11-18 retro (#1102).
  - The guard ideas from that retro (0031 to 0034) got no implementation PR in this window, and their frictions recur at the same scale (findings 5 and 6).
  - The tools behind 0019 and 0035 did ship. Their open question is adoption (finding 2).
- **Proposed change:** a ticket. `harness idea new --kind harness` runs `idea sync`, so the idea's GitHub issue exists from the start.
- **Hypothesis:** none. It is a tool fix, checked by a count.
- **Metric:** none in the flow report. The check is the count of idea records with no `issue:` line, expected to reach 0. `friction.total` is a shared guard metric and is not used as a primary (ADR 0119).
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none.

## Smaller signals, not ranked

- **Old bash.**
  - Claude Code refused 13 commands because bash 3.2 is too old ([scan]).
  - The repo reads `CLAUDE_CODE_SHELL` in `guard-host-shell.ts`, but the setting lives on the owner's machine.
  - Check a main session's actual `CLAUDE_CODE_SHELL` and `SHELL` before any ticket, and never change it without the owner.
- **Scan noise in repeated corrections.**
  - 16 of 17 groups are spawn briefs, `[griller]` follow-ups or `RESULT: done` pings ([fork]).
  - A developer-tool ticket: `isOrchestratorBrief` in `retro-transcript.ts` excludes them, with a unit test.
- **Override noise in launches.**
  - All 99 judge launches are logged as tier overrides ([ledger]), because `judge.md` sets effort `medium` and judges launch at `high`.
  - Aligning the definition would change judge cost and review quality, so this goes to the decider with send-back and cost data (owner decision 7).
- **Two scan proposals.** Remove the unused skill `add-policy` and the unused agent `judgment`. Already idea 0037.
- **Exit code 137.** 13 kills ([scan]), including a `session spawn` at `112bd8fe:97372`. A note only.

## Overall read

Delivery is in good shape:

- Changes merged in a median of about 13 minutes.
- Send-backs stayed low.
- Recommended decisions went to the advisor, which was never overturned.
- Flags turned on only after recorded outcomes.

The Haiku writer arm reads cheaper for now, but only barely, and with a higher
blocked share.

What costs the most sits above the writers, in the main session ([ledger] and [flow]):

- One long context reaches 480k-token prompts and is re-woken more than 300 times by a stop hook and a timer.
- It polls GitHub and panes, although the wait, signed-send and tick flags were already on before the window opened.
- Main-session cost per merged change is above the writing cost.

The fixes for that are already filed:

- Ideas 0019 and 0035 wait on the orchestrator tick starting.
- Idea 0038 holds the compaction-cap sequence, which the owner sets after the baseline.

The second pattern is attribution and follow-through:

- 35 opened PRs never linked to an idea.
- The guard ideas from the last retro had no issue and no PR.
- So the same guard false positives come back at the same counts.

This retro therefore files no new idea. It proposes small tickets that close those gaps, and adds its evidence to the ideas that already own each problem.
