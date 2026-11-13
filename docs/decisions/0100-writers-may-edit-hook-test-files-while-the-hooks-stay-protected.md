---
status: accepted
summary: A writer may create, edit, move and delete a hook test file directly in .claude/hooks, but the hook scripts, settings, the bundle and the .claude folder stay protected.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0100: Writers may edit hook test files, while the hooks stay protected

Source: [`infra/plans/14-test-tiers.md` § Step 1](../../infra/plans/14-test-tiers.md#step-1-foundations)

Refines: [ADR 0091](0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md), which froze the writer guard and left test fixes needing a session outside it; this opens only the hook test files.

## Context

ADR 0091 freezes the role guards and treats `.claude/hooks` as protected. The
guard protects the hook scripts, and it also covers the hook test files
(`.claude/hooks/*.test.mjs`), which are not the guard. Writers could not fix a
leaking test fixture or move a test to the integration tier, so each change
needed a session started outside the guard.

## Decision

A writer may create, edit, move out and delete a hook test file, which is a
regular file directly in `.claude/hooks` whose name is a literal ending
`.test.mjs`. The exemption is an allowlist, not a name check inside any command:

- **File tools.** `Write` and `Edit` may take such a path, relative or inside
  this worktree by absolute path, when it is not an existing symlink or folder.
- **Bash.** Only a call that is one segment whose first word is literally
  `git` or `rm`, with no wrapper, assignment or path in the command name, and
  no `&&`, `;`, `|`, `&`, `#`, redirect, substitution or newline. The command is
  `git mv <hook tests> <destination>`, `git rm <hook tests>` or
  `rm [-f] <hook tests>`, with no other flag. Each named hook test must be an
  existing regular file (the Write tool may also create a new one). A `git mv`
  destination, a file or an existing folder, must be literal, outside `.claude`
  and not a symlink.
- **Everything else** that names a path under `.claude/hooks` in a writing
  command is refused as before: `mv`, `cp`, `install`, `ln`, a redirect, `tee`,
  `sed -i`, `git checkout`, `git restore`, a glob, variable, brace or path climb
  and a path outside this worktree. A `git` line with a flag before its verb
  (`git -C dir mv`) counts as writing. The allowlist's moves leave `.claude` and
  nothing else in Bash may name a path under `.claude/hooks`, so Bash does not
  put a file, link or folder under a test name. A command that also names a
  protected file is refused.

The settings files, `skills/bin`, the hook scripts and the `.claude` folder stay
protected with the same refusal, and path names compare without regard to case
since the disk may ignore it. This loosens an enforced guard, so it is the
owner's approval under ADR 0080, recorded in #440 and in the `role-read-only`
note of `.claude/guardrails.yaml`.

## Consequences

Test fixes under `.claude/hooks` no longer need a session outside the guard,
and a test moved to the integration tier leaves with one `git mv`. A writer
who needs to rename a test inside the hooks folder, or copy one in, asks the
person. Inline code that names a hook test file (`node -e`) stays blocked,
because the guard cannot read what it writes. The hook scripts still need the
owner.

These files are run by the commit hook's `test:hooks` and by CI, so a writer
can make one write a protected file when it runs. That was already true of any
spec. The tests that verify the hooks and settings are now writer-editable and
deletable; the pull request's reviewer and CI stay the check on them.

One limit remains: the symlink and folder checks read the disk once, before the
call. A hard link, or a link in a parent folder of a `git mv` destination, is
not seen. That is the standing limit of
[ADR 0091](0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md):
the role guards are a hint, and containment comes from separate identities and
the sandbox, not from this check.

The CI `check` workflow runs `mise run test-harness-integration` beside the hook
tests, because the guard's real-parser case is an integration test and ADR 0098
reserves those for releases and hook changes. This is a stopgap until #418
gives integration tests their own place, and the step moves there then.
