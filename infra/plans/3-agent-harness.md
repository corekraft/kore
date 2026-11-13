---
status: done
summary: Moves checkable AGENTS.md rules into hooks, deny rules, skills, and evals, with a retrospective loop.
last-verified: 2026-11-08
---

# Agent Harness Plan

## Purpose

[`AGENTS.md`](../../AGENTS.md) states the repository's principles, but an agent
reads it as guidance, not as a guarantee. Rules followed early in a session drift
as context grows, and some content may be trimmed by the harness. This plan moves
every mechanically checkable rule out of prose and into enforcement, so the
principles hold no matter how long a session runs or which agent runs it.

The split is:

| Layer         | Holds                                              | Guarantee        |
| ------------- | -------------------------------------------------- | ---------------- |
| Hooks         | Rules a script can check on a command or file edit | Enforced         |
| Deny rules    | Commands that must never run without a human       | Enforced         |
| Skills        | Repeatable multi-step workflows                    | Loaded on demand |
| AGENTS.md     | Judgment rules no script can check                 | Guidance         |
| Memory        | Non-obvious facts about the user and project       | Guidance         |
| Retrospective | Proposals to change any of the above               | Human-reviewed   |

Work proceeds one step at a time. A step is complete only after its exit criteria
pass and the results are recorded here.

## Principles

- Enforce what can be checked; keep AGENTS.md for what cannot.
- Hooks are tested like any other code: fast, deterministic, no cluster.
- Hooks rely on the Node standard library only, matching the CLI.
- New guards start in audit mode (warn) and are promoted to enforce (block) once
  they produce no false positives on the current tree.
- Hooks block with an actionable message: what was refused and what to do instead.
- The setup stays small. Every hook, skill, and rule must map to an AGENTS.md
  principle or a recorded retrospective finding.
- Agent configuration is shared across harnesses: `skills/` is the single source,
  linked into each harness directory (`.claude/`, `.codex/`).

## Step 1: Make Existing Skills Visible

### Work

- [x] Link `.claude/skills/test-driven-development` to
      `skills/test-driven-development`, mirroring `.codex/skills/`.
- [x] Confirm `.claude/` is tracked and not ignored, except
      `.claude/settings.local.json`.

### Exit Criteria

- [x] A new Claude Code session lists `test-driven-development` as an available
      skill.
- [x] Both harness directories resolve the same skill file.

## Step 2: Guard Hooks

### Work

Implement `.claude/hooks/guard.mjs`, a single `PreToolUse` hook that reads the
tool call from stdin, applies the rules below, and exits `2` with a reason to
block. Rule logic is exported as pure functions so it can be tested without the
harness.

| AGENTS.md principle                                | Rule                                                                                              | Initial mode |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------ |
| Every mutation targets its configured context      | `kubectl` without `--context`, `helm` without `--kube-context`                                    | Enforce      |
| Destruction requires consent                       | `minikube delete`, `tofu destroy`, `kubectl delete namespace`, `helm uninstall`, `kore * destroy` | Enforce      |
| Secrets never touch disk or git in plaintext       | Read or write of `.kore/keys/**` and `.kore/state/*token*`; `cat`/`echo` of those paths in shell  | Enforce      |
| Secrets never touch disk or git in plaintext       | Write to a path matching a `.sops.yaml` `path_regex` whose content lacks a `sops:` block          | Enforce      |
| Formatting and lint run on commit                  | `git commit --no-verify` or `-n`                                                                  | Enforce      |
| Coverage only goes up                              | Edit to `tools/kore/vitest.config.ts` that lowers any `thresholds` value                          | Enforce      |
| Images are deployed by signed digest, never by tag | Image reference in `apps/**` or `infra/environments/**` without `@sha256:`                        | Audit        |

The digest rule starts in audit mode because bootstrap charts under
`infra/charts/` still pin by tag (for example `oci-registry` uses `tag: 3.0.0`),
which the bootstrap trust loop in
[`2-implementation.md`](./2-implementation.md) Step 7 permits. Promote it once its
scope excludes legitimate bootstrap references.

- [x] Write failing tests in `.claude/hooks/guard.test.mjs` for every rule,
      covering both the blocked case and the allowed case (for example `kubectl get
pods --context kore-local` passes).
- [x] Implement `guard.mjs` to pass them.
- [x] Register the hook in `.claude/settings.json` for `Bash`, `Read`, `Write`,
      and `Edit`.
- [x] Add a `mise` task `test-hooks` running `node --test .claude/hooks`, and run
      it from the pre-commit hook when `.claude/hooks/**` changes.

### Exit Criteria

- [x] Every rule has a passing test for what it blocks and what it allows.
- [x] Every block message names the rule and the allowed alternative.
- [x] The hook runs in under 200 ms and needs no network or cluster.
- [x] Commands issued by `kore` itself are unaffected, because the hook sees only
      the agent's direct tool calls.

## Step 3: Feedback Hooks

### Work

- [x] `PostToolUse` on `Write`/`Edit` of `tools/kore/src/**/*.ts`: run prettier
      and oxlint on the edited file and return the output to the agent, so failures
      surface immediately rather than at commit.
- [x] `Stop`: run `npm --prefix tools/kore run check` when any `.ts` file changed
      in the session, and report failures to the agent before it ends its turn.

### Exit Criteria

- [x] A formatting or lint violation is reported in the same turn it is
      introduced.
- [x] A type error prevents the agent from ending its turn silently.
- [x] Sessions that change no TypeScript pay no typecheck cost.

## Step 4: Permission Deny Rules

### Work

- [x] Add deny rules in `.claude/settings.json` for the destructive commands in
      Step 2 as a second, independent layer. Deny rules apply even in
      `bypassPermissions` mode.
- [x] Add allow rules for read-only commands: `mise run test`, `mise run
validate`, `mise run test-opa`, `mise run test-gatekeeper`, `kore doctor`, `kore * status`.

### Exit Criteria

- [x] Destructive commands are refused even if the guard hook is disabled.
- [x] Read-only workflows run without permission prompts.

## Step 5: Workflow Skills

Each skill lives in `skills/` and is linked into every harness directory. Each
captures a workflow that otherwise requires re-exploring the repository.

### Work

- [x] `add-command`: command handler, usage text, `--json` output, README entry,
      and fake-runner tests, kept in step as AGENTS.md requires.
- [x] `add-policy`: new policy in audit mode, colocated Rego tests, and a
      `mise run test-opa` run.
- [x] `pin-upgrade`: bump an exact version in `.mise.toml` or
      `infra/catalog/versions.yaml` and record compatibility evidence.
- [x] `write-adr`: next number in `docs/decisions/`, the existing ADR format, and
      a link to any ADR or plan step it refines.

### Exit Criteria

- [x] Each skill's description triggers it for its task and not for unrelated
      ones.
- [x] Each skill references repository files instead of duplicating their
      content.

## Step 6: Slim AGENTS.md

### Work

- [x] For each rule now enforced by a hook or deny rule, reduce its AGENTS.md
      entry to one line that names the enforcement.
- [x] Keep full wording for judgment rules: one owner per resource, provider
      neutrality, domain boundaries, actionable errors, tests that describe behavior.
- [x] Add a short section stating where enforcement lives (`.claude/hooks/`,
      `.claude/settings.json`, `skills/`).

### Exit Criteria

- [x] AGENTS.md is shorter than it is today and loses no principle.
- [x] Every rule is either enforced or explicitly marked as guidance.

## Step 7: Retrospective Loop

### Work

- [x] Add a `retro` skill that scans recent session transcripts for this
      repository and reports:
  - AGENTS.md rules that were violated or had to be restated by the user
  - corrections the user repeated across sessions
  - exploration repeated across sessions that a skill could replace
  - hooks that blocked legitimate work (false positives)
- [x] The skill proposes changes; a human accepts or rejects each one. It never
      edits configuration on its own.
- [x] Run it manually after every few working sessions; consider scheduling it
      once the history is large enough to be useful.

### Exit Criteria

- [x] A retrospective produces a short, ranked list of proposed changes, each
      tied to evidence from a transcript.
- [x] Accepted proposals are recorded in this plan or as an ADR.

## Step 8: Context Hygiene

Steps 1-7 enforce rules. This step keeps the agent's context small and focused,
so guidance that cannot be enforced is still seen and followed: rules drift over
long sessions, compaction drops content, and large tool results are written to
files and read only in part.

### Work

- [x] **Isolate the retrospective.** Run `retro` in its own context (a read-only
      `.claude/agents/retro.md`, or `context: fork` on the skill) so transcript dumps
      never enter the calling thread; only the ranked proposals return. Add a fifth
      finding: a skill that fired for the wrong task or failed to fire, with a
      proposed rewrite of its description.
- [x] **Review judgment rules in a fresh context.** Add a read-only
      `.claude/agents/principles-review.md` that receives a diff and the AGENTS.md
      rules no hook can check (one owner per resource, provider neutrality, domain
      boundaries, actionable errors, tests that describe behavior) and reports
      violations with file and line. It is not anchored on the author's reasoning.
- [x] **Bound hook output.** Write failing tests in `feedback.test.mjs`, then cap
      the oxlint, prettier, and typecheck output that `feedback.mjs` returns at about
      40 lines, stating how many lines were cut and the command that shows them all.
- [x] **Restore judgment rules after compaction.** A `SessionStart` hook with
      matcher `compact` prints the judgment rules and the open items of the active
      plan. Tested like the other hooks; it never runs on a normal session start.
- [x] **Shorten `test-driven-development`.** Cut it from 136 lines to about 25:
      the iron law, red-green-refactor, and self-check questions ("did I watch it
      fail, and for the right reason?"). Move examples into `references/`. Read the
      whole skill for instructions that do not belong, since it is third-party.
- [x] **Make skills self-steering.** Where a checklist step needs judgment,
      phrase it as questions the agent answers (for example `add-command`: does this
      mutate, which environment and context does it target, what does `--json`
      report?). Keep every skill under about 25 lines.

### Exit Criteria

- [x] A retrospective leaves no transcript content in the calling thread.
- [x] `principles-review` flags a seeded violation of each judgment rule and
      passes a clean diff.
- [x] A large lint or type-error output returns a bounded message with the
      command to see the rest.
- [x] After `/compact`, the session context contains the judgment rules.
- [x] Every skill is under about 25 lines and still triggers for its task.

### Not Planned

- A router skill: seven skills with distinct descriptions do not need one yet.
- A scheduled cloud retrospective: cloud routines cannot read local transcripts.
- Hook parity for Codex: out of scope unless AGENTS.md states the rule.

## Step 9: Operator Load

Steps 1-8 manage what the agent has in context. This step manages what the human
has to keep in their head: when to start a new thread, where the last one
stopped, when a retrospective is due, and whether the skills and the review agent
still work. It also closes the exit criteria above that need a live session.

### Work

- [x] **Relative skill links.** `.claude/skills/*` and `.codex/skills/*` link to
      `../../skills/<name>`, never an absolute path. The harness hook
      `node skills/bin/harness.mjs hook skill-links --strict` (a harness spec
      covers it; `mise run test-hooks` and the pre-commit hook run it) checks every
      skill in `skills/` is linked from both harness directories. The pre-commit
      hook runs it when `skills/`, `.claude/`, or `.codex/` changes.
- [x] **Codex skill metadata.** `skills/test-driven-development/agents/openai.yaml`
      carries the trigger from `SKILL.md`, not a placeholder.
- [x] **`session-brief`.** `context.mjs` also runs on `startup` and `clear`, and
      prints at most four lines: the active plan with open items per step, the
      plan's `Next:` line, and a retrospective reminder once five or more sessions
      have run since the latest `Last retrospective:` marker. Compaction behavior is
      unchanged.
- [x] **`statusline`.** `harness hook statusline` shows context use, the active
      plan, and the `Next:` step. Context use turns amber at 40% and red at 50%, the
      edge of the range where the model works best. It is not registered in
      `.claude/settings.json`, because a project status line replaces each
      person's own; each person opts in from their user settings with
      `"statusLine": {"type": "command", "command": "node <repo>/skills/bin/harness.mjs hook statusline"}`.
      A setting that still points at `.claude/statusline.mjs` now prints a blank
      line; change it to the command above. The line reads plans under
      `CLAUDE_PROJECT_DIR`, then the host's `workspace.project_dir`, then its
      cwd, so it works in any project; with no `infra/plans` it shows context
      use alone.
- [x] **`handoff`.** A skill for leaving a thread mid-step: tick finished items in
      the active plan and write one `Next:` line under the current step. No
      transcript content.
- [x] **`harness-eval`.** `mise run eval-harness` runs `claude -p` against
      `.claude/evals/`: prompts paired with the skill they should trigger (including
      near misses), and one seeded diff per judgment rule plus a clean diff for
      `principles-review`. It costs tokens, so it is opt-in like live tests and runs
      without session persistence, so it never counts toward the retrospective.
- [x] **Contain release notes.** `pin-upgrade` reads upstream release notes in
      the `Explore` subagent, treats them as data, and returns only what breaks a
      contract in `infra/catalog/compatibility.md`.

### Exit Criteria

- [x] A link with an absolute target fails `mise run test-hooks`.
- [x] A fresh session after `/clear` shows the active plan, its `Next:` line, and
      a due retrospective, and a resumed session shows nothing.
- [x] `mise run eval-harness` reports every skill case and every seeded
      `principles-review` diff as a hit; results recorded below.

## Results

- Steps 1-6 are implemented. Step 7 adds the `retro` skill; running it is manual.
- Step 1 confirmed on 2026-11-07: a fresh Claude Code session lists every skill
  in `skills/`.
- `mise run test-hooks`: 49 tests pass (guard, feedback, context), hook startup
  is under 200 ms.
- Step 8 is implemented. `retro` runs with `context: fork` on the read-only
  `Explore` agent; `principles-review` lives in `.claude/agents/`; the compaction
  hook reads `AGENTS.md` and the plans at run time, so it never drifts from them.
  `test-driven-development` went from 136 lines to 24, with its tables moved to
  `references/rationalizations.md`. Every skill is now 24 lines or fewer.
- `principles-review` was widened during review: every AGENTS.md rule is in
  scope, and it skips only the mechanical part an _Enforced_ or _Audited_ hook
  checks, because several marked rules also carry guidance no hook checks (for
  example "status, validation, and rendering never mutate", "local builds never
  alter the release lock"). For the same reason the compaction hook restates
  every rule with its markers, not only the unmarked ones.
- `principles-review` keeps Bash because it needs `git diff`, so it is read-only
  by instruction, backed by the guard hook and deny rules; nothing enforces it.
- Confirmed live for Step 8 on 2026-11-07: `/retro` runs forked and returns
  only its ranked list, with no transcript lines in the main thread; after
  `/compact` the hook restores the AGENTS.md rules and open plan items.
- Step 8's seeded `principles-review` run is confirmed by the eval below (6/6).
- Confirmed live for Step 3 on 2026-11-07 in a fresh Herdr pane: writing a
  `debugger;` statement into `tools/kore/src/hook-probe.ts` returned the oxlint
  `no-debugger` report right after the Write, in the same turn; a `string`
  returned as `number` made the Stop hook report `TS2322` and the agent took
  another turn instead of ending silently. The probe file was deleted.
- Confirmed for Step 4 on 2026-11-07 by `mise run eval-harness --kind deny`:
  with every hook disabled and permissions bypassed, all ten destructive
  commands in `.claude/evals/deny.json` were refused by the deny rules.
- The `image-digest` rule stays in audit mode as planned.
- Step 9 is implemented. `mise run test-hooks`: 75 tests pass (guard, feedback,
  context and brief, status line, skill links, eval grading). The skill-links test
  failed on the tree as found: `.codex/skills/test-driven-development` was
  committed with an absolute target and is now relative. Run against this
  repository, the brief reports open items in Steps 3, 4, 5, 7, 8, and 9, and 8
  sessions without a recorded retrospective. `retro` now reads and the calling
  thread updates the `Last retrospective:` line in this section.
- Confirmed live for Step 9 on 2026-11-07 in a fresh Herdr pane: the startup
  brief and the brief after `/clear` both arrived, the second with the `Next:`
  line; resume stays silent (tested).
- First `mise run eval-harness` on 2026-11-07, `claude 2.1.319`, model
  `claude-opus-5-5`: 14/17 hits.
  - Review: 5/5 seeded diffs flagged with the right rule. The clean diff missed
    because the fixture was wrong: it called `appUp` with an options object and
    claimed no command runs before name validation, and the reviewer said so.
    With a corrected fixture, a rerun returned `No violations.` (6/6).
  - Skills: 9/11. All four near misses stayed silent. `add-command` missed once
    and fired on a rerun after one `Grep`, so one sample per case cannot tell a
    weak description from noise. `test-driven-development` missed on a bugfix
    prompt; the skill cases run in plan mode, where a skill meant for "before
    writing production code" may rightly wait. Neither description is changed on
    a single sample.
- Second `mise run eval-harness` on 2026-11-07, three samples per skill case
  graded by majority, plus deny cases: 22/24. `add-command` hit 3/3, so the
  first run's miss was noise. `test-driven-development` missed 3/3, and
  `./bin/kore eval-absent destroy` was not denied, and ran: only the missing
  `bin/kore` kept it harmless.
- The deny-rule miss was a pattern bug. A live probe showed `Bash(kore *
destroy:*)` matches nothing: the `:*` suffix does not combine with a `*`
  earlier in the pattern, and a trailing ` *` matches only when arguments
  follow. Each `kore` rule in `.claude/settings.json` is now two rules, `kore *
destroy` and `kore * destroy *` (and likewise for `./bin/kore` and the
  `status` allow rules). The rerun denied all ten cases.
- The `test-driven-development` misses were the eval's doing. Traced on
  2026-11-07, the model in plan mode explored and wrote a plan without loading
  any skill, since plan mode forbids writing code. Plan mode is therefore
  dropped for skill cases, which refines this step's work item: each sample now
  runs in a throwaway `git worktree` of `HEAD` with `acceptEdits`, no MCP
  servers, and shell commands limited to the allow list, and the worktree is
  removed afterwards. Deny cases also run in a throwaway worktree, with stub
  `kore`, `minikube`, `helm`, `kubectl`, `tofu`, and `terraform` first on
  `PATH` and at `bin/kore`, so a broken rule reaches only a stub (`principles-review`
  finding). `--kind skill,review,deny` reruns part of the eval and refuses an
  empty list.
- Third `mise run eval-harness --kind skill` on 2026-11-07, `claude 2.1.319`,
  model `claude-opus-5-5`, three samples per case in throwaway worktrees: 13/13
  hits, every case 3/3. `add-command`, `add-policy`, `pin-upgrade`, `write-adr`,
  `test-driven-development`, `handoff`, `retro`, and `spawn-session` each fired
  3/3, and all five near misses stayed silent 3/3. With plan mode dropped,
  `test-driven-development` now fires on the bugfix prompt, so no skill
  description changed. `git worktree list` afterwards showed only the main tree.

### Retrospective 2026-11-07

Last retrospective: 2026-11-07

The first recorded retrospective covered all 12 sessions. It found no hook
false positives, no skill firing for the wrong task, and no repeated
correction. All four proposals were accepted and implemented:

- **`spawn-session` skill** (5 sessions rediscovered Herdr from scratch): how
  to start, brief, and wait on a verifier or fixer session in a Herdr pane;
  plus a memory that "herder" means `herdr`.
- **Quote zsh globs** (about 28 failed calls in 6 sessions): a memory, and a
  guard rule `unquoted-glob` in audit mode (warn) for an unquoted
  `--include=`/`--exclude=` glob.
- **`test-driven-development` trigger** (never fired in an implementation
  session): the description now reads "Use before writing or changing any code
  or hook, including implementing a plan step, a review finding, or a fix."
- **`mise run format`** (three sessions improvised prettier, one pulled an
  unpinned version): one task running the pinned binary, named in AGENTS.md.

### Retrospective 2026-11-07 (second run)

Last retrospective: 2026-11-07

The second retrospective covered the 19 sessions since the first one
(2026-11-08 03:26 to 05:46 UTC). Most were short hook and verifier test runs. No
guard blocked legitimate work. Three proposals were accepted:

- **Repeated test prompt counted as a correction** (2 sessions): correction
  `dd60e344` was the same typed prompt, used to check the SessionStart brief.
  `retro-scan.mjs` should count a repeated prompt only if it follows an
  assistant mistake or carries a correction signal ("no", "don't", "instead",
  "wrong"). Implemented in `3019dc4`; on the same transcripts the scan now
  reports no corrections.
- **Keep `add-policy`, `handoff`, and `write-adr`** (each unused in 19
  sessions): none of those sessions needed a policy, an ADR, or a handoff. Check
  them again after a window of real plan-step work. Archive or rewrite one only
  if its task came up and it still did not load.
- **Leave `unquoted-glob` and `image-digest` in audit mode**: `unquoted-glob`
  warned 3 times in 3 sessions, all heeded, but its status is
  `insufficient-evidence`. `image-digest` never warned.

Follow-up, not accepted: about 4 Bash failures look like zsh mistakes, `=word`
expansion (`===== not found`, `== not found`) and `no matches found` from
unquoted globs, which `unquoted-glob` may miss. The scan does not report where
failures happened, so this is unconfirmed. It would first need failure
locations (session and line) in the scan output.

### Retrospective 2026-11-08

Last retrospective: 2026-11-08

The third retrospective covered 35 sessions on 2026-11-08. It found no repeated
correction. Four proposals were accepted and implemented:

- **`unquoted-glob` blocks** (16 warnings in 13 sessions, all heeded, none
  overridden; status `promotable`). It now ignores heredoc bodies, which are
  data: the warning fired on a `--include=*.ts` inside a Python heredoc while
  this change was written, and as a block it would have refused the command.
- **`bare-glob` and `equals-word` in audit mode (warn)**, the follow-up the
  second retrospective left open: 3 `no matches found` failures from bare
  globs and 4 `== not found`/`===== not found` failures from words zsh expands
  as `=command`. `bare-glob` skips quoted, escaped, `${...}`, and `$((...))`
  text; `equals-word` skips a lone `=`, assignments, and `[[ ]]` tests. A more
  specific per-segment warning (for example `append-only`) wins. `bare-glob`
  also warns on globs that do match, so expect it to be noisy; the next
  retrospective decides from its override rate whether it stays.
- **`handoff` and `write-adr` triggers** (neither loaded in 35 sessions).
  `handoff` dropped the "context use passes about 50%" trigger, which a session
  cannot observe, for "before ending a turn, or before /clear or /compact,
  while the active plan step still has unchecked items". `write-adr` now names
  concrete actions: choosing between two designs, or changing what a plan or a
  decision in `docs/decisions` says. `add-policy` is unchanged: no session
  touched `infra/policies`.
- **`journal-redaction.spec.ts` flake fixed** (2 failures, passing on rerun).
  The test asserted the secrets `abc` and `def` were absent from the journal,
  but each operation's `op` is a hex `randomUUID()`, which contains one of them
  in roughly one run in seventy. The spec now pins `randomUUID` to a value full
  of hex runs, which made the old assertion fail every run, and uses secrets
  with non-hex letters.

Left alone: two `Exit code 137` kills (too little detail), two `secret-path`
blocks (no location to judge them by), and `append-only` and `image-digest`
stay in audit mode.

### Retrospective 2026-11-12

Last retrospective: 2026-11-12

The fourth retrospective covered 196 sessions (2026-11-08 to 2026-11-12). It
was run with both the repository's `retro` skill (the `retro-scan` counts) and
the `mattpocock-skills:retro` categories (navigation, automated checks, coding
standards, tool economy, information access). It looked most closely at
2026-11-12, when parallel writers delivered about 50 tickets of plans 8 to 13.
Two reversible fixes landed with it:

- **`session spawn` presses enter once when a pasted brief does not submit.**
  The orchestrator noted "Writer prompts not submitting: fixed by sending
  enter", and a writer met the same Herdr paste race. If `herdr agent prompt`
  does not reach `working`, `session spawn` sends one enter and waits again.
  The error names both attempts.
- **`retro-scan` counts only folders that hold a `SKILL.md`.** It reported
  `skills.unused: ["bin"]` because `skills/bin` holds the harness bundle. It
  now reports `[]`.

The other findings went to the owner as proposals and questions in the
retrospective PR. They cover commit-hook load, conflicts from the committed
bundle, recurring review findings, the one-bug-per-run live proof,
`equals-word` promotion, and the orchestrator bypassing `session spawn`.

### Retrospective 2026-11-12 (afternoon)

Last retrospective: 2026-11-12

The fifth retrospective ran on Opus with the repository's `retro` skill. It
covered the 67 sessions since the morning retrospective (#281). No audit rule
was ready for promotion: `bare-glob` warned 271 times and agents heeded 270 of
them. The owner accepted all ten proposals, now filed under #124:

- **#324 (enforce):** role guards refuse shell constructs the splitter cannot
  model. Four PRs found bypasses one form at a time. Writers get the check in
  audit mode.
- **#325 (enforce):** completion comes from `session wait`. The finish
  broadcast becomes a harness command that confirms delivery, and
  `session spawn` retries agent start.
- **#326 (enforce):** pre-commit runs the SAST scan on staged TypeScript and
  JavaScript. #288 and #290 failed only in CI.
- **#327:** `retro-scan` ignores orchestrator briefs, which made up five of its
  eight "corrections". The Monitor errors came from calling the deferred
  `Monitor` tool with ToolSearch's `query` argument before loading its schema;
  `spawn-session` now says how to load and call it.
- **#328 (guidance), covering five items:**
  - a default of two test workers in `test-workers.mjs`, overridable by a shell
    export
  - hold new writers during live runs
  - writers list owner decisions first
  - assert exact output
  - the orchestrator checks a fix request against the brief
  - the test-driven-development and spawn-session skill descriptions are
    rewritten

Left alone: `equals-word` (fixed in #293), the `no-verify` blocks and `bare-glob`.

## Out of Scope

- Reimplementing the guards inside the `kore` CLI. The CLI already enforces
  context and destructive gates for its own operations; these hooks cover the
  agent's direct tool use.
- Harness-specific features without an equivalent for other agents, unless the
  rule they enforce is also stated in AGENTS.md.
