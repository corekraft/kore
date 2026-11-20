---
summary: Guards read command words, not script or body text
hypothesis: If role-no-merge stops refusing harness flag activate --help, and a PR body no longer reaches the guard as command text, writer blocks on legitimate work fall to at most 2 per 14 days
expected-outcome: Since 2026-11-16T14:00Z, the flow report shows 4 role-no-merge blocks, class unclassified; they are the baseline. The earlier 26 of 28 were mostly pre-guidance, before #912 told writers to write multi-line files with the Write tool (2026-11-16). After the help fix and --body-file, the remaining legitimate blocks fall to at most 2 per 14 days
measurement: guardBlocksByRule.role-no-merge in harness flow report; retro-scan --evidence classifies the blocks that remain; the guard corpus passes in CI; a guardrail replay of the window lists the newly allowed commands (an empty list is stated as empty)
safety-pattern: feature-flagged
date: 2026-11-17
kind: harness
hypothesis-metric: guardBlocksByRule.role-no-merge
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/964
outcome: inconclusive
---

# Idea 0022: Guards read command words, not script or body text

## Notes

- **Primary metric and guard metric.** The primary is `guardBlocksByRule.role-no-merge`, the block count of the guard this idea changes, under the guard-idea exception in ADR 0119: fewer false blocks is the claim itself. Direction down, window 14d, opening 2026-11-16T14:00Z. `friction.total` is a guard metric only, shared with idea 0011 (#798) and idea 0013 (#801); it is not this idea's claim. The sed -i, perl -pi and node -e filter is dropped, because `flow report` has no per-command split and the ledger never gains command text.
- **The role-worktree half is dropped.** It re-proposed #845 (PR #902), which the decider closed as wontfix on 2026-11-17. A review-only judge pass found two bypasses: a bare `of /` in `node -e` hid a write path, and a heredoc that writes a script run by a later call (`cat > a.sh`, then `sh a.sh`). Containment is the sandbox (ADR 0091, ADR 0095), and no new guard rule is added (ADR 0101); false positives go to writer.md guidance. The root fix of #813 piece 1 landed in #879.
- **The baseline is restated.** writer.md has told writers to use the Write tool, not a heredoc, since #912 (2026-11-16 06:43 local). The flow report for `--since 2026-11-16T14:00:00Z` counts 4 `role-no-merge` blocks, with class unclassified. The earlier 26 of 28 `role-no-merge` blocks are recorded as mostly pre-guidance. The 28 blocks since 2026-11-12 in this idea and the ledger's 25 all-time count come from different sources; they are not reconciled here.
- **Park, not build.** The idea is parked until 2026-11-30 (owner decision on #964, comment 6950010261, 2026-11-17). Guard code is written only if the re-check shows more than 2 legitimate `role-no-merge` blocks per 14 days remain. This fits the guard freeze (ADR 0091, ADR 0101).
- **Re-check on 2026-11-30.** Run `node skills/bin/harness.mjs flow report --json --since 2026-11-16T14:00:00Z`, read `guardBlocksByRule.role-no-merge`, and run `node skills/bin/harness.mjs hook retro-scan --evidence` over the same window to classify the remaining blocks as heredoc, `--body` or `--help` text. Record whether more than 2 legitimate blocks per 14 days remain. If so, file a new spec for the heredoc change; do not extend spec #970. No ticket for the re-check is filed now, because it cannot start before that date.
- **Heredoc scope, if the guard changes later.** A heredoc body counts as data only as the text argument of `gh pr create`, `gh issue ...` or `harness pr open`. A body redirected to a file or piped to a shell (`cat > a.sh`, then `sh a.sh`) stays a bypass. Decided on the owner's answer on #964 (comment 6950010261).
- **The two pieces are split out.** Piece 1, the `--help` exemption in `role-no-merge` behind the `gated-help-exempt` flag, is #973; it has no idea of its own and is a quick fix under ADR 0091, and the owner has approved its activation in local once the guardrail replay's newly allowed list is empty and an outcome is recorded. Piece 2, `harness pr open --body-file`, is #974 (`no-behaviour-change`, ADR 0099). Widening `--body-file` to `decision ask` and `judge send-back` is #982, blocked by #974.
- **Activation is the owner's.** The `gated-help-exempt` flag is not turned on by a writer; only `harness flag activate` turns it on, after the owner's approval (ADR 0080, ADR 0120).

## Outcome

- Result: inconclusive
- Kind: experiment
- Source: journal
- Evidence: Mac ledger: 35 role-no-merge blocks in total, 14 since 2026-11-16T14:00Z and 9 since gated-help-exempt turned on (2026-11-18T03:15Z); target at most 2 legitimate blocks per 14 days; the blocks are not classified as legitimate or not (no retro-scan --evidence run), and the guardrail replay never completed
- Recorded: 2026-11-20

The Mac ledger holds 14 role-no-merge blocks since the window opened, but none is classified as legitimate or not, so the target cannot be judged.
