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

- [ ] A formatting or lint violation is reported in the same turn it is
      introduced.
- [ ] A type error prevents the agent from ending its turn silently.
- [x] Sessions that change no TypeScript pay no typecheck cost.

## Step 4: Permission Deny Rules

### Work

- [x] Add deny rules in `.claude/settings.json` for the destructive commands in
      Step 2 as a second, independent layer. Deny rules apply even in
      `bypassPermissions` mode.
- [x] Add allow rules for read-only commands: `mise run test`, `mise run
validate`, `mise run test-opa`, `kore doctor`, `kore * status`.

### Exit Criteria

- [ ] Destructive commands are refused even if the guard hook is disabled.
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

- [ ] Each skill's description triggers it for its task and not for unrelated
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
- [ ] Run it manually after every few working sessions; consider scheduling it
      once the history is large enough to be useful.

### Exit Criteria

- [ ] A retrospective produces a short, ranked list of proposed changes, each
      tied to evidence from a transcript.
- [ ] Accepted proposals are recorded in this plan or as an ADR.

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

- [ ] A retrospective leaves no transcript content in the calling thread.
- [ ] `principles-review` flags a seeded violation of each judgment rule and
      passes a clean diff.
- [x] A large lint or type-error output returns a bounded message with the
      command to see the rest.
- [ ] After `/compact`, the session context contains the judgment rules.
- [ ] Every skill is under about 25 lines and still triggers for its task.

### Not Planned

- A router skill: six skills with distinct descriptions do not need one yet.
- A scheduled cloud retrospective: cloud routines cannot read local transcripts.
- Hook parity for Codex: out of scope unless AGENTS.md states the rule.

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
- Still to confirm live for Step 8: a seeded `principles-review` run and skill
  triggering.
- Still to confirm in a fresh Claude Code session: the feedback hooks firing
  live, and the deny rules (Step 3, 4, 5 exit criteria left open).
- The `image-digest` rule stays in audit mode as planned.

## Out of Scope

- Reimplementing the guards inside the `kore` CLI. The CLI already enforces
  context and destructive gates for its own operations; these hooks cover the
  agent's direct tool use.
- Harness-specific features without an equivalent for other agents, unless the
  rule they enforce is also stated in AGENTS.md.
