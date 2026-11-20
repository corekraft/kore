---
summary: General retro over about 130 role sessions and the main session from 2026-11-18T02:13Z to 2026-11-20; seven proposals, none applied, no ideas filed.
date: 2026-11-20
last-verified: 2026-11-20
---

# General Retro 2026-11-20

This retro has no narrower lens. It asks how delivery went, what to keep, and
what cost the most time, tokens or owner attention. These findings are
proposals. The main session files ideas from them once it has every retro doc.

## Window and sources

- Window: 2026-11-18T02:13:52Z to 2026-11-20T08:30Z.
- In that window the ledger (`.kore/state/ledger.jsonl`) holds 39,099 events:
  - 196 `session.launch`, 133 `pr.opened`, 131 `pr.merged`;
  - 39 `send-back`, 297 `guard.block`, 64 `pane.stalled`;
  - 18 `session.compacted`, 10 `outcome`, 8 `flag.activated`.
- `.kore/state/sessions/*.json` holds 190 spawned panes from the window: 98 judges, 73 writers, 10 readers and 9 principles-review panes.
- GitHub shows 132 PRs merged in the window.
- Also used:
  - the precomputed `retro-scan.json` (`hook retro-scan --strict`, 250 sessions) and `flow-report.json` (`flow report --json`, unscoped);
  - a `/retro` skill fork run with `--evidence`;
  - the in-window part of the main-session transcript `112bd8fe`, which starts at line 86887.
- Token figures are cumulative `token.split` deltas per session and model, taken across the window boundary.

## What worked and should be kept

- **Throughput with little owner attention.**
  - 131 merges in about 54 hours.
  - The median lead time per merged change is 758 s (`leadTimePerMergedChange`), and the trailing average is 738 s.
  - `ownerQuestions.questions` is 0.
  - Send-backs stay low, at 0.11 per merged change.
  - The advisor made 10 decisions and none was overturned (`advisorQuality`).
- **The Haiku writer default holds.**
  - The randomized arm comparison (`writerArms.overall`) puts Haiku at 2.65 and Sonnet at 3.20 all-in per merged change.
  - The difference is -0.55, with a 95% interval of -1.11 to -0.02.
  - Haiku's blocked share is higher, 0.33 against 0.10, and it is still cheaper overall.
- **Live proof gates activation.** The 8 `flag.activated` events each follow a recorded `outcome` event.
- **The 2026-11-14 zsh and `cd` fixes landed.**
  - `unquoted-glob` blocks fell from 264 to 13 per window, and `equals-word` from 99 to 11.
  - `cd`-inside-the-worktree blocks no longer dominate `role-worktree` (see finding 6).

## The findings

Ranked by frequency times cost, most expensive first.

## 1. Cap the main session's context instead of looping one 480k-token transcript

- **Evidence:**
  - The main sessions carry 826M of the window's 1,987M cache-read tokens (42%).
    - `112bd8fe` alone carries 704M over 2,871 requests, about 245k tokens per request.
    - Its largest prompt is 480,379 tokens.
  - `tokensByStagePerMergedChange.current.perMerged` puts orchestrate at 149,885 tokens per merged change, more than writing at 116,349.
    - `writerCost.current.orchestrate` prices orchestration at 931 dollars, against 3.32 for all judges.
  - The same context ran from 2026-11-12 to 2026-11-20, and in the window it was driven by:
    - 226 stop-hook re-prompts of a delivery goal (first at `112bd8fe:87533`, then `112bd8fe:93555` and `112bd8fe:98505`);
    - 98 periodic wakes (`112bd8fe:87340`).
  - `mainSessionSetups.compactionCap` is null, and every stretch is labelled `not set`.
  - The transcript is 197 MB and 117,404 lines. `retro-scan --evidence` ran out of memory on it at the default heap (the `/retro` fork). The precomputed scan was rerun without `--evidence` for the same reason.
- **Proposed change:**
  - Set `cost.compactionCap` in `.claude/harness.json`. `session prompt-size` and `mainSessionSetups` already read it, and it is unset today.
  - When the cap is reached, the main session's stop hook runs the `handoff` skill and asks for a fresh main session instead of re-prompting the goal.
  - Separately, make `retro-transcript.ts` stream line by line and drop events before `--since` as it reads.
- **Hypothesis:** if the main session hands off at a fixed prompt size, each orchestration turn re-reads less context, and orchestrate tokens per merged change fall below writing tokens.
- **Metric:** `tokensByStagePerMergedChange.current.perMerged.orchestrate`, down, 7 days.
- **Safety pattern:** `feature-flagged`
- **Already filed:** none. Related: 0019 and 0038 cover waits, not context size.

## 2. The main session waits on events instead of polling

- **Evidence:**
  - In-window main-session tool calls:
    - 343 `sleep` calls (`112bd8fe:86967`, `112bd8fe:89622`, `112bd8fe:93189`);
    - 702 `gh pr view` and 277 `gh pr checks`, against 258 `harness wait` and 61 `harness session wait`;
    - 122 raw `herdr agent prompt` and 124 `herdr agent read`.
  - The scan counts 1,525 foreground poll minutes, 891 pane reads, and 890 raw sends against 44 signed sends across 48 main sessions.
  - `finishDetection` reports 552 results: 365 undetected, and 308 never noticed.
  - Idea 0035 was filed on 2026-11-18 with 747 raw sends against 4 signed and 1,340 poll minutes. The share is barely better now, so this is long-standing.
- **Proposed change:**
  - The stop-hook goal loop runs `harness wait` across its open PRs and panes, and re-prompts only when that returns a change.
  - Add an audit-mode guard warning on raw `herdr agent prompt` from the main session that names `harness session send`.
- **Hypothesis:** if the loop blocks on `harness wait` instead of re-prompting into `sleep` and `gh pr view`, poll minutes per merged change fall and fewer finishes go unnoticed.
- **Metric:** `mainSession.foregroundPollMinutesPerMerged`, down, 7 days.
- **Safety pattern:** `feature-flagged`
- **Already filed:** 0035, and 0038. 0019 and 0021 are related.

## 3. Route every merge through `harness judge merge`, with a recorded acceptance path

- **Evidence:**
  - Of 132 PRs merged in the window, 78 had review decision `REVIEW_REQUIRED` at merge, so they merged without an approving review.
  - In the window the main session ran:
    - `gh pr merge` in 106 tool calls: 64 with `--admin`, and 41 without `--match-head-commit`;
    - `harness judge merge` only 15 times.
  - Examples: `112bd8fe:99320`, `112bd8fe:102802`, `112bd8fe:116823`.
  - The main session also ran 180 `review post`, 173 `judge precheck` and 47 `judge approve` itself, while 98 judge panes were spawned.
  - The owner had an agent post merge acceptances by hand for pattern mismatches (`112bd8fe:99161`, `5dfa430d:7217`, from the `/retro` fork).
- **Proposed change:**
  - Add an `--accept <reason>` option to `harness judge merge`. It records an acceptance ledger event, still pins the head and re-runs every other gate, so a pattern mismatch the owner or advisor accepts merges through the tool.
  - Add an audit-mode guard rule that warns on a bare `gh pr merge` from the main session.
- **Hypothesis:** if acceptances have a tool path, merges stop bypassing the precheck and head pin, and the share of merges with a recorded review rises.
- **Metric:** `reviewRounds.unlinked.reviewCoverage`, up, 7 days. No flow metric counts admin merges yet, and one is worth adding.
- **Safety pattern:** `feature-flagged`
- **Already filed:** none. Related: 0018 covers the judge's own identity.

## 4. Writer spawns carry their idea

- **Evidence:**
  - All 196 `session.launch` events in the window lack an idea, and 195 `spawn.unstamped` events were recorded.
  - Because of that, the flow report cannot attribute cost:
    - `writerCost.current.unjoinable` is 480 of 560 merged changes;
    - `reviewRounds.unlinked.mergedChanges` is 480;
    - `metrics.tokensPerIdea` reports `insufficient history` (2 closed ideas, 6 needed).
  - About 20 of the window's 26 `feat(harness)` PRs added flow-report figures (#1189, #1196, #1250 to #1255), and most of them read through that missing link.
- **Proposed change:**
  - `harness session spawn --role writer` refuses a launch with no `--idea N` and no `--idea none`, the same way `pr open` handles `--idea`.
  - The `session spawn` usage text states the flag.
- **Hypothesis:** if a writer cannot launch unstamped, merged changes join to their idea, and the per-idea and per-tier figures leave `insufficient`.
- **Metric:** `unstampedSpawns.total`, down, 7 days.
- **Safety pattern:** `feature-flagged`
- **Already filed:** 0012.

## 5. Let read-only roles redirect, loop and read the diff the allowed way

- **Evidence:**
  - The window ledger has 240 `role-read-only` blocks: 101 in judges, 74 in subagents of `112bd8fe`, 32 in answerers and 16 in readers. The scan counts 167 in transcripts.
  - The blocked commands, from tool results:
    - 27 `git fetch -q` (`1239f264:120`, `a1631117:71`);
    - 22 `gh pr diff N >` redirected to a scratch file (`112bd8fe/subagents/agent-a41c1fe04d9b2adb9:25`, `agent-a4308e7ca66680b04:15`);
    - 21 or more `for` loops over allowed reads;
    - 11 `harness.mjs` subcommands;
    - 10 `gh api` GETs.
  - The `/retro` fork sampled 20 blocks and found most legitimate: 6 `for` loops, 5 command substitutions and 4 stderr redirects.
  - The owner rejected allowing `git fetch` (#417, item 4d), yet `principles-review.md` still says "otherwise `git diff main...HEAD`" and names no fetch-free diff.
  - This is long-standing: it was finding 2 on 2026-11-14 and idea 0031 on 2026-11-18.
- **Proposed change:**
  - In `guard-role-allow.ts`, allow:
    - a redirect into the session's own scratchpad;
    - `for` loops whose bodies are allowed reads;
    - stderr redirects;
    - `gh api` with no `-X`, `-f` or `-F`.
  - In `.claude/agents/principles-review.md` and `reader.md`, name `harness judge diff <pr>` for a PR diff.
- **Hypothesis:** if the common read forms pass and the definitions name the allowed diff read, read-only panes stop retrying blocked commands.
- **Metric:** `guardBlocksByRule.role-read-only`, down, 14 days.
- **Safety pattern:** `feature-flagged`
- **Already filed:** 0031, and 0013.

## 6. Guards read command words, not substitution scripts or query text

- **Evidence:**
  - There were 46 `role-worktree` blocks in the window. In the `/retro` fork's sample of 20, 15 were legitimate:
    - 12 `sed -i` or `perl -pi` substitutions inside the worktree, whose `/` delimiters were read as absolute paths (`578e705e:517`, `91bfc793:983`);
    - 2 `node -e` bodies (`c66d13ae:127`).
  - `role-no-merge` also matched code text: the words "flag activate" in a script (`9c2180af:164`).
  - In this session it blocked a read-only `gh api graphql` query whose text contained the word "merged".
- **Proposed change:** in `guard-role-delivery.ts` and the `role-no-merge` matcher, stop scanning `sed`/`perl` substitution scripts, inline interpreter code and quoted query arguments for paths or verbs.
- **Hypothesis:** if guards skip script and query text, legitimate edits and reads inside the worktree stop being blocked, and the correct blocks of `cd` out of the worktree stay.
- **Metric:** `guardBlocksByRule.role-worktree`, down, 14 days.
- **Safety pattern:** `feature-flagged`
- **Already filed:** 0022, and 0033.

## 7. Retro ideas reach the ready frontier

- **Evidence:**
  - The 2026-11-18 retro filed seven ideas, 0031 to 0037, in #1102.
    - None has an `issue:` line. In all, 11 of 51 idea records have no issue.
    - None of 0031 to 0035 got an implementation PR in this window.
  - In the same window, 26 `feat(harness)` PRs merged.
  - The frictions those ideas target recur at the same scale: findings 2, 5 and 6 above, `friction.total` 3,240.
  - Idea 0035's own baseline is unchanged (finding 2).
- **Proposed change:**
  - `harness idea new --kind harness` runs `idea sync`, so every harness idea gets its GitHub issue at once.
  - The `retro` skill labels that issue `ready-for-agent` once the owner's triage accepts it, which puts it in the owner's ready-ticket query.
- **Hypothesis:** if accepted retro ideas become ready issues when filed, the friction they target falls within the next retro window instead of being re-reported.
- **Metric:** `friction.total`, down, 14 days.
- **Safety pattern:** `no-behaviour-change`
- **Already filed:** none.

## Smaller signals, not ranked

- **Old bash.** Claude Code refused 13 commands as too complex for bash 3.2. Setting `CLAUDE_CODE_SHELL` to the pinned zsh or a newer bash would end that.
- **The scan's repeated-corrections list is noise again.**
  - 16 of 17 groups are spawn briefs at line 7, `[griller]` follow-ups and `RESULT: done` pings.
  - `isOrchestratorBrief` in `retro-transcript.ts` should treat a role session's first user message as a brief.
- **Override noise in launches.**
  - All 99 judge launches are logged as tier overrides, because `judge.md` says effort `medium` and every judge is launched at `high`.
  - 41 Sonnet writers were overrides with no `--pr` escalation.
  - Aligning the definitions with practice would make `tierShares` readable.
- **Two scan proposals.** Remove the unused skill `add-policy` and the unused agent `judgment`. Already filed as 0037.
- **Memory pressure.** 13 `Exit code 137` kills, including `session spawn` at `112bd8fe:97372`.

## Overall read

Delivery itself is in good shape:

- Changes merge in a median of about 13 minutes.
- The owner was asked nothing.
- The Haiku writer default pays off.
- Flags turn on only after recorded outcomes.

What costs the most sits above the writers, in the main session:

- One context of 245k to 480k tokens is re-woken more than 300 times by a stop hook and a timer.
- It polls GitHub and panes instead of waiting on events.
- It often merges with `--admin` around the judge tool built to pin the head.

Orchestration now costs more tokens per merged change than writing does.

The second pattern is the more worrying one. The harness got better at measuring itself:

- About 20 flow-report PRs landed.
- The measurements cannot join to ideas, because no spawn was stamped.
- None of the friction ideas from the last retro was delivered, so the same guard false positives come back at the same counts.

The highest-value changes are to make the main session cheap and event-driven (findings 1 and 2), and to make merges and spawns go through the tools that record them (3 and 4). After that, the long-standing guard fixes need a route to delivery (7), not another filing.
