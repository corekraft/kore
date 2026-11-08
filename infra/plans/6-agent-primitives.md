---
status: active
summary: Give the harness an operations journal it owns, protect append-only records, and tell the agent what changed between turns.
last-verified: 2026-11-07
---

# Agent Primitives Plan

## Purpose

[`5-self-maintenance.md`](./5-self-maintenance.md) made the harness check
itself. Three primitives from always-on agent design are still missing. First,
`kore` keeps no record of what it did: the only trace of a mutation is the
transcript of the session that ran it, so a partial `local up` cannot be traced
or resumed from repository state. Second, append-only records such as
`.claude/evals/history.jsonl` can be rewritten by the agent that reads them.
Third, the agent learns the state of the repository and the platform only at
session start, while parallel Herdr sessions keep changing both.

This plan adds an operations journal that only `kore` writes, a guard rule that
keeps journals append-only, and a hook that injects only what changed since the
last turn. Everything uses the Node standard library and needs no cluster.

## Principles

- The harness owns the journal. `kore` appends; agents read. Nothing rewrites
  or truncates a journal.
- Never journal secrets. Process `input` and `env` are never recorded, and
  secret-looking flag values are redacted before writing.
- Fail closed before mutating, fail open after. If the journal cannot record
  the start of an operation, the operation does not start. A later write
  failure warns and lets the mutation finish.
- Context hooks fail open, print nothing when nothing changed, and stay short,
  so the prompt cache stays warm.
- New guard rules start in audit mode, as in plan 3.
- Test first, with the fake runner, fixture files, and temporary directories.

## Journal Format

One file per environment: `.kore/state/journal/<environment>.jsonl`, one JSON
object per line, appended under the environment lock. `.kore/` is gitignored.

```json
{"ts":"2026-11-07T10:00:00.000Z","op":"<uuid>","kind":"start","environment":"local","command":"local up","context":"minikube"}
{"ts":"...","op":"<uuid>","kind":"exec","command":"helm","args":["upgrade","--install","..."],"code":0,"ms":1234}
{"ts":"...","op":"<uuid>","kind":"end","outcome":"ok","ms":5678}
{"ts":"...","op":"<uuid>","kind":"end","outcome":"failed","error":"<first line, at most 200 characters>","ms":90}
```

- `kind` is `start`, `exec`, or `end`. `outcome` is `ok` or `failed`.
- `context` is the configured kube context of the environment, when it has one.
- An `op` with a `start` and no `end` is an interrupted operation.
- Redaction: in `args`, the value of any flag whose name contains `password`,
  `secret`, `token`, or `key` (`--flag=value` or `--flag value`) becomes
  `<redacted>`.

## Step 1: Operations Journal

### Work

- [ ] Add a journal to the `runtime` domain: append an entry, read entries for
      an environment, and a `Runner` decorator that records an `exec` entry per
      command. Export them through `runtime/index.ts` only.
- [ ] Wrap every mutating command in `cli.ts` (the commands that take
      `withEnvironmentLock`) so it writes `start`, the decorated runner's `exec`
      entries, and `end` with its outcome. Read-only commands write nothing.
- [ ] Add a read-only `kore journal --environment <name> [--limit <n>] [--json]`
      that lists recent operations with their outcome, and flags interrupted
      ones. Follow `skills/add-command`, and update the usage text and
      `README.md`.

### Exit Criteria

- [ ] Tests show: a successful and a failed operation write `start`, `exec`,
      and `end`; `input` and `env` are never written, even when they hold a
      secret; flag values are redacted in both forms; a read-only command
      writes nothing; a start-entry write failure stops the operation before
      the runner is called.
- [ ] `kore journal` reports an interrupted operation from a fixture journal.
- [ ] `npm --prefix tools/kore run check` and `mise run test` pass, and
      coverage does not drop.

## Step 2: Append-Only Guard

### Work

- [ ] Add an `append-only` rule to `.claude/hooks/guard.mjs`, in warn mode, for
      `.claude/evals/history.jsonl` and `.kore/state/journal/*.jsonl`. It warns
      on `Edit` and `Write`, and on Bash segments that truncate, rewrite, or
      remove them: `>` (not `>>`), `sed -i`, `rm`, `mv`, or `truncate`.
- [ ] The message says who owns the file and the fix: append through the owning
      script (`eval.mjs`, `kore`), never edit by hand.
- [ ] Note the rule in AGENTS.md under the matching principle as _Audited_.

### Exit Criteria

- [ ] `guard.test.mjs` covers each warned form, and that `>>`, `cat`, `Read`,
      and `tail` on the same files are allowed.
- [ ] `node .claude/hooks/retro-scan.mjs` lists `append-only` among audit rules.
- [ ] `mise run test-hooks` passes.

## Step 3: What Changed Between Turns

### Work

- [ ] Add a `UserPromptSubmit` hook, `.claude/hooks/delta.mjs`, wired in
      `.claude/settings.json`. It keeps a per-session snapshot in the git
      directory (`$(git rev-parse --git-dir)/kore-delta/<session_id>.json`):
      `HEAD` and branch, `main`'s commit, open items per plan, files in
      `.kore/locks/`, and the last journal entry per environment.
- [ ] On the first prompt of a session it writes the snapshot and prints
      nothing. Afterwards it prints only what differs, at most 600 characters:
      new commits on `main`, plan items ticked or added, locks taken or
      released, journal operations started, finished, or failed.
- [ ] Reads go through injectable functions so tests use fixtures. The hook
      fails open and exits 0 on any unexpected input.

### Exit Criteria

- [ ] `delta.test.mjs` covers: first prompt prints nothing; no change prints
      nothing; each kind of change is reported; output is capped; malformed
      input exits 0 without output.
- [ ] `mise run test-hooks` passes.

## Step 4: Environment in the Session Brief

### Work

- [ ] In `context.mjs`, add one line per environment journal to the startup
      brief: the last operation, its outcome, and its date, and say so when it
      was interrupted. Read only the journal files; never call `kore`,
      `kubectl`, or `minikube` from a hook.

### Exit Criteria

- [ ] `context.test.mjs` covers no journal, a finished operation, a failed
      one, and an interrupted one.
- [ ] `mise run test-hooks` passes.

## Not Planned

- Undo of journaled operations. Reconciliation belongs to the upstream tools;
  the journal records, it does not replay.
- A cluster call from a hook. Hooks read local files only.
- Scheduled wake-ups, a `retro` dreaming mode, and recording proposal outcomes.
  Revisit after this plan, using the journal as their input.

## Results
