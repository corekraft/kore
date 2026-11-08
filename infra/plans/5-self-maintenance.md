---
status: done
summary: Make the harness check and maintain itself, with CI, a deterministic retrospective scan, usage-driven pruning and promotion, eval history, and stale-doc detection.
last-verified: 2026-11-07
---

# Self-Maintenance Plan

## Purpose

[`3-agent-harness.md`](./3-agent-harness.md) moved the checkable rules into
hooks, and [`4-knowledge.md`](./4-knowledge.md) made the reasons reachable. Both
still depend on a person to keep them up. Every check runs only on the machine
that makes the commit, so a commit made elsewhere, or with hooks skipped, reaches
`main` unchecked. The retrospective has a model re-read raw transcripts on every
run. Nothing records whether a skill is still used, whether an audit rule is
ready to enforce, whether eval results improve or regress, or whether a
document's `last-verified` date still matches the files it describes.

This plan moves each of those jobs into deterministic code. The model is kept
only for judgment. Everything runs with the Node standard library and needs no
cluster.

## Principles

- Deterministic first. A script counts, compares, and dates; a model only
  interprets the result. No model calls in CI.
- The scripts report and propose; a human accepts. Nothing here edits hooks,
  settings, skills, or `AGENTS.md` on its own.
- New checks start in warn mode and are promoted once the tree is clean, as in
  plans 3 and 4.
- Remove before adding. A finding that a skill or rule is unused is as valuable
  as one that a new one is needed.
- Test first, without a cluster or a live session: fixtures stand in for
  transcripts, git history, and eval runs.

## Step 1: Continuous Integration

### Work

- [x] Add `.github/workflows/check.yml`, run on `pull_request` and on `push` to
      `main`. Run the same checks as the commit and stop hooks: `npm ci` in
      `tools/kore`, `npm --prefix tools/kore run check`, `mise run test`,
      `mise run test-hooks`, `mise run test-opa`, `mise run validate`, and
      `mise run kb-check -- --strict`.
- [x] Install tools through mise from `.mise.toml`, limited to what the checks
      need (`node`, `npm`, `opa`), so CI uses the same pinned versions as a
      developer.
- [x] Pin every third-party action by full commit SHA, with the release tag in a
      trailing comment. Give the workflow `permissions: contents: read` and no
      secrets.
- [x] No step calls a model, needs a cluster, or reaches the network beyond
      installing pinned tools and packages.

### Exit Criteria

- [x] The workflow passes on this branch's pull request.
- [x] A commit that breaks any one check fails the workflow at that step. Show
      this once on a throwaway branch and record the result.
- [x] `grep -E 'uses: [^@]+@[^0-9a-f]' .github/workflows/*.yml` matches nothing.

Making the check required on `main` changes repository settings. That is
outward-facing, so it is proposed to the user and not done by an agent.

## Step 2: Deterministic Retrospective Scan

### Work

- [x] Add `.claude/hooks/retro-scan.mjs`. It reads the session transcripts
      (`~/.claude/projects/<project>/*.jsonl`) since the `Last retrospective:` date
      in `3-agent-harness.md`, or a directory passed with `--dir`, and prints JSON:
  - sessions scanned, with first and last timestamps
  - guard blocks and warnings per rule (`[guard:<rule>]`)
  - failed tool calls grouped by tool and a normalized error, top ten
  - skills loaded per session (`Skill` tool calls and slash commands)
  - user messages that repeat a correction across sessions: same normalized
    phrase in two or more sessions
- [x] Export the parsing and grouping as pure functions, and test them against
      small fixture transcripts in `.claude/hooks/fixtures/retro/`.
- [x] Make `skills/retro/SKILL.md` run the scan first and read transcripts only
      to quote evidence for a finding the scan surfaced. The skill stays under about
      25 lines.

### Exit Criteria

- [x] `node --test .claude/hooks` covers each count above with a fixture,
      including a malformed line that is skipped and does not crash the scan.
- [x] The scan runs over this repository's real transcripts in under two
      seconds and prints no transcript text beyond rule names, tool names, and
      error summaries of 120 characters or less.
- [x] One `/retro` run after the change returns its ranked list. Record how many
      transcript files it opened compared with the previous run.

## Step 3: Prune and Promote From Usage

### Work

- [x] Extend the scan's JSON with `skills.unused`: skills in `skills/` loaded in
      no scanned session.
- [x] Extend it with `rules.promotable`: audit-mode guard rules (warn only) whose
      warnings in the scanned sessions were all followed by the agent changing the
      command, with none overridden or restated by the user. Report the number of
      sessions observed. A rule with fewer than five observed warnings is reported
      as `insufficient-evidence`, never as promotable.
- [x] `retro` turns each entry into a proposal: archive or rewrite the
      description of an unused skill; promote a promotable rule to enforce mode.

### Exit Criteria

- [x] Fixture tests cover a used and an unused skill, and a rule that is
      promotable, one overridden by the user, and one with too few warnings.
- [x] Run against the real transcripts, the scan names the current status of
      `image-digest` and `unquoted-glob`. Record it in Results.

## Step 4: Eval History

### Work

- [x] `eval.mjs` appends one JSON line per run to
      `.claude/evals/history.jsonl`: date, `claude` version, model, kinds run, and
      hits and samples per case. `--no-history` skips it.
- [x] `eval.mjs --trend` reads the history and prints, for each case, its hit
      rate over the last five runs and whether it is below its previous five. It
      makes no model calls.
- [x] `history.jsonl` is committed, so the trend is shared and reviewed with the
      change that caused it.

### Exit Criteria

- [x] Tests cover appending, `--no-history`, a trend over fewer than five runs,
      and a regression, using a temporary history file and no `claude` calls.
- [x] The three runs recorded in `3-agent-harness.md` Results are entered into
      the history as its first lines, marked `"source": "backfill"`.

## Step 5: Stale Documents

### Work

- [x] `kb-check` warns when a plan or ADR has a `last-verified` date older than
      the latest commit to a file it links to, or to a file whose `Docs:`, `Plan:`, or
      `ADR:` marker points back at it. The warning names the document, its date, and
      the newest such file and commit date.
- [x] Git history is read through one injectable function, so tests use
      fixtures and never a real repository.
- [x] Warn mode only. `--strict` ignores staleness until a later step promotes
      it.

### Exit Criteria

- [x] Tests cover a current document, a stale one through a link, a stale one
      through a back-marker, and a document with no linked files.
- [x] `mise run kb-check` on this tree lists the stale documents, or none.
      Record the count in Results.

## Not Planned

- A remote worker on a VPS, or scheduled cloud agents. Live cluster steps in
  [`2-implementation.md`](./2-implementation.md) are still open, and
  transcripts are local, as noted in plan 3.
- Connectors to email, calendars, or payment services. Nothing here needs them,
  and each one makes prompt injection more dangerous.
- An eval framework dependency such as Promptfoo. `eval.mjs` does the job with
  the standard library.
- A scheduled dependency-update routine. Revisit once Step 1 has run on `main`
  for a while.

## Results

- Step 1: `.github/workflows/check.yml` runs the seven checks in order on
  `pull_request` and `push` to `main`. Actions are pinned to
  `actions/checkout` v7.0.1 (`3d3c42e5`) and `jdx/mise-action` v5.2.7
  (`b44d12e7`), the latest releases, resolved with `gh api`. mise installs
  only `node npm opa`.
- Step 1: `.claude/hooks/workflow.test.mjs` guards the workflow: SHA pins,
  triggers, read-only permissions, no secrets, step list and order, tool
  subset, and no model calls. It failed first because the file was missing.
- Step 1: All seven commands pass locally in this worktree, and the exit-criteria
  `grep` matches nothing.
- Step 1: The checks also use the runner's own `git` (for `kb-check`), which is
  not installed through mise.
- Step 1 (pending, needs a push): the workflow passing on this branch's pull
  request, and the throwaway failing branch. Both exit criteria stay unticked
  until the user approves a push. Making the check required on `main` is also
  pending the user.
- Step 1: confirmed on 2026-11-07 on PR #6, run 42451880499: every step ran and
  passed in 22 s. `mise install node npm opa` installed only those three, and
  the harness tests reported 160 passing. The failing-branch criterion is shown
  below.
- Step 1: failing-branch probe on 2026-11-07, draft PR #7 (closed, branch
  deleted). An invalid `node` pin in `versions.yaml` failed at **Unit tests**,
  and every later step was skipped. The unit tests read the real catalog, so
  the pin broke two checks and CI stopped at the first. A dead link in
  `docs/index.md`, which only `kb-check` catches, then failed at **Knowledge
  base** (run 42452143340) after every earlier step passed. The error named
  `docs/index.md:105` and the fix.
- Step 4: `eval.mjs` appends one line per run to `.claude/evals/history.jsonl`
  (`--no-history` skips it) and `--trend` prints each case's rate over its last
  five runs against the five before, with no model calls. Tests use a temporary
  history file and a fake `claude`. The three runs from plan 3 are backfilled
  with `"source": "backfill"`. Plan 3 recorded per-case results only for the
  third run (13 skill cases, 3/3 each); the first two are aggregates (9/11 skill
  and 5/6 review; 22/24 overall), so they enter the trend as one pseudo-case
  each and only the third contributes per-case rates. No live eval was run.
- Step 5: `kb-check` lists stale plans and ADRs as `stale:` warnings through an
  injectable `commitDate` (a fixture in tests, `git log -1 --format=%cs` live).
  They never affect the exit code, including under `--strict`. `mise run
kb-check` on this tree: 0 stale documents.
- Step 5: CI checks out with `fetch-depth: 0`. A shallow clone dates every
  file at the tip commit, so stale-document warnings in CI would be wrong.
  `workflow.test.mjs` asserts it.
- Step 2: `retro-scan.mjs` and its 18 tests pass (`node --test .claude/hooks`,
  116 tests). Over the 18 real transcripts it runs in about 0.3 s and prints
  only rule names, tool names, and error summaries of 120 characters or less.
  After `Exit code N` the scan keeps the first line that looks like an error:
  a whole-word keyword (`error`, `failed`, `not found`, `no such`, ...) or a
  shell prefix (`(eval):N:`, `zsh:`), skipping lines that start like Markdown
  or code. Otherwise it keeps the bare exit code. Lead review went through two
  rounds: the first non-empty line was usually stdout, and then keywords
  matched inside identifiers. On the real transcripts, two of thirteen
  failures still pick up a line of prose that contains a keyword. That is
  accepted; the summary is capped at 120 characters and only points `retro` to
  where to look. Corrections are reported as a short hash plus
  session and line, never as text; only phrases of four or more words count.
  Without `--dir`, the scan finds the main checkout's transcript directory
  through `git --git-common-dir`, so it works from a worktree.
- Step 2: the live `/retro` exit criterion is not done. It needs an interactive
  slash command, which this session could not run. Pending: run `/retro` once
  and record how many transcript files it opens compared with the previous run
  (the scan itself reads all 18 files in one pass and the skill now opens only
  the lines the scan names).
- Step 3: `skills.unused` and `rules.promotable` come from the same scan.
  Overridden means a human message arrived between the warning and the agent's
  next call of the same tool; repeated means that next call was identical;
  unresolved means no later call. All three block promotion. Fixture tests
  cover a used and an unused skill, a promotable rule, one the user overrode,
  and one with too few warnings.
- Step 3: on the real transcripts, `unquoted-glob` is `insufficient-evidence`
  (3 warnings in 3 sessions, all heeded, none overridden) and `image-digest` is
  `insufficient-evidence` (0 warnings). Unused skills: `add-policy`,
  `handoff`, `write-adr`; none is archived on this evidence, since the
  transcripts cover a single day.
- Follow-up: transcript timestamps are UTC, while `Last retrospective:` is a
  local date. A session that falls on a different calendar day in UTC than
  locally is counted on the wrong side of the boundary. `context.mjs` already
  had this problem, and the scan now shares it by reusing that function. Fix
  both together; not in this plan.
- Step 2: live `/retro` on 2026-11-07, in an Opus session in a Herdr pane. It
  returned a ranked list of three proposals in 26 s. The forked run opened 2
  transcript files, only at the lines the scan named. The first retrospective
  read all 12 sessions' transcripts. The three proposals are recorded and
  accepted in `3-agent-harness.md`. One is a scan false positive: a repeated
  neutral prompt counted as a correction. It is fixed in `3019dc4`.
- Done: every work item and exit criterion is ticked. `main` now requires the
  `check` status. Admins can bypass it, and force pushes and branch deletion
  are blocked.
