# Contributor Guide

How to change this repository. The rules are in [`AGENTS.md`](../../AGENTS.md);
this page is the short path through them.

## Set up

```sh
mise install
mise exec -- npm --prefix tools/kore install
mise exec -- npm --prefix tools/harness ci
mise run harness-build
```

`harness-build` creates `skills/bin/harness.mjs`, which hooks and skills run;
see [The harness bundle](#the-harness-bundle).

## The loop

1. **Find the reasons first.** Start at [`docs/index.md`](../index.md); read the
   plan step and the ADRs it links.
2. **Write a failing test**, watch it fail for the right reason, then the least
   code that passes. Fast tests fake the process runner and need no cluster
   ([`skills/test-driven-development/SKILL.md`](../../skills/test-driven-development/SKILL.md)).
3. **Check:**

   ```sh
   cd tools/kore && npm run check && npm run lint && npm test
   mise run validate
   mise run test-opa
   mise run test-gatekeeper
   mise run test-promtool
   mise run kb-check -- --strict   # also fails a skill over its description or body budget
   mise run scan
   ```

   Format by hand with `mise run format <files>`, never a bare `npx prettier`.

4. **Commit** with a Conventional Commit, lowercase imperative subject
   (`feat(ci): guard release signer permissions`). Hooks run typecheck, lint,
   format, and only the unit tests related to the staged files (`vitest related`, two
   workers); `--no-verify` is blocked. A staged config file
   (`package.json`, `tsconfig.json`, `vitest.config.ts`, `package-lock.json`,
   kore's `src/test-setup-support.ts`) runs the whole package suite instead.
   Specs read `infra/` and `apps/` by path, so a staged file there runs the
   specs that name its directory (`tools/kore/.husky/related-tests.mjs`). The
   full suites with coverage thresholds run in CI `check`, which the `main`
   ruleset requires before merge (changes to that ruleset go through
   `harness ruleset sync --dry-run`, then `--confirm` after the operator
   agrees; a changed rule starts in the `main-candidate` ruleset, ADR 0090); run them locally with `mise run test`. The
   Stop hook only typechecks.

   Unit runs are capped so a busy host stays usable. Both packages' vitest
   configs read `tools/kore/.husky/test-workers.mjs`: a quarter of the CPUs,
   at least two, or `KORE_TEST_WORKERS` (a positive whole number; CI sets its
   own). The hook also runs its tests under a host-wide lock
   (`tools/kore/.husky/test-lock.mjs`, `.kore/state/test.lock` in the main
   checkout), so commits in many worktrees queue and print `waiting for another
worktree's tests (pid N)`. It waits up to 15 minutes
   (`KORE_TEST_LOCK_WAIT_MS`), breaks a lock whose pid is gone, and on timeout
   names the holder and the file to remove.

## Where things live

| Change                                | Look at                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| A `kore` command or flag              | `tools/kore/src/cli`; usage text in `usage.ts`; skill `skills/add-command/SKILL.md` |
| A domain (platform, app, images, ...) | `tools/kore/src/<domain>`; depend on its `index.ts`, not its internals              |
| A component, version, or seed         | `infra/catalog`; skill `skills/pin-upgrade/SKILL.md` for versions                   |
| A chart or environment setting        | `infra/charts`, `infra/environments/<name>`                                         |
| A policy                              | `infra/policies`; skill `skills/add-policy/SKILL.md`                                |
| A decision                            | `docs/decisions`; skill `skills/write-adr/SKILL.md`                                 |

## Tests

- `npm test` (in `tools/kore`) is fast and needs no cluster.
- Live specs (`*.integration.spec.ts`) create or destroy clusters. They run only
  when asked, with `KORE_RUN_INTEGRATION=1` through the scripts in
  `tools/kore/package.json` (`test:integration`, `test:integration:admission`,
  `test:integration:registry`). A cluster-facing `no-behaviour-change` needs a live
  run before merge; any other cluster-facing change merges behind a flag and
  needs the live run before the flag turns on (see Feature flags).
- The `nightly` workflow (`.github/workflows/nightly.yml`) runs a clean
  `kore local up` and every `test:integration*` suite against one cluster through
  `tools/kore/scripts/nightly.sh`, purging the profile last. Its run conclusion is
  the status on main. It needs GNU `timeout` (`gtimeout` from coreutils on macOS)
  and a dedicated self-hosted runner labelled `kore-nightly`; registering it is an
  owner step ([ADR 0093](../decisions/0093-the-nightly-live-proof-runs-on-a-dedicated-self-hosted-runner-under-bounded-timeouts.md)).
  `ProcessRunner` kills a command past its timeout (helm mutations get twice
  their `--timeout` plus a margin) and names it; kubectl reads carry
  `--request-timeout`.
- Upstream chart and container checks are opt-in too (`test:upstream-charts`,
  `test:container-smoke`).

## The harness bundle

`skills/bin/harness.mjs` is generated from `tools/harness/src` and is not
committed ([ADR 0092](../decisions/0092-the-harness-bundle-is-a-build-output-not-a-committed-file.md)),
so harness PRs conflict only when a source file does. Hooks run it through
`.claude/hooks/harness.sh`.

- A fresh worktree has no bundle. The guard hook then blocks tool calls and
  prints the fix: `npm ci --prefix tools/harness && mise run harness-build`.
- Rebuild with `mise run harness-build` after pulling harness changes. Harness
  test runs rebuild it too.
- `KORE_HARNESS_BUNDLE` points the launcher at a bundle elsewhere, for example
  a read-only copy. It never falls back to the worktree copy.
- A worktree made by hand with `git worktree add` runs no git hook. Run
  `npm ci --prefix tools/kore`, `npm ci --prefix tools/harness` and
  `mise run harness-build` in it; `session spawn --worktree` does this itself.
- A branch that committed a rebuilt bundle hits a one-time modify/delete
  conflict when it rebases onto the change that stopped tracking it. Resolve it
  with `git rm --cached skills/bin/harness.mjs`, then `git rebase --continue`.
- CI builds the bundle before it runs anything that needs it.

## Feature flags

Flags are the `features:` map in `infra/environments/<env>/environment.yaml`,
off by default ([ADR 0077](../decisions/0077-live-proof-gates-activation-not-merge.md)).
Dark launch means on only in `local`.

1. Merge the change with its flag `false`.
2. Prove it live, then record the proof:
   `node skills/bin/harness.mjs outcome record --idea <n> --kind verification --source live-run --result confirmed --flag <name> --environment <env> --evidence <run> --summary <text>`.
3. `node skills/bin/harness.mjs flag activate <name> --environment <env>` edits
   the overlay only when that confirmed outcome exists, and records a
   `flag.activated` ledger event. Without proof it refuses and changes nothing.
4. `flag audit` exits 1 when any flag is on without proof. `kb-check` runs it
   and reports a warning, which never fails `--strict` (ADR 0080: audit before
   enforce); the `flag-activation` guard also warns on a hand edit.
5. Removing the flag, its overlay entries and its gated code is the contract step of
   expand-contract, after the outcome is confirmed.

## Flow report

`node skills/bin/harness.mjs flow report [--json]` reads the stage ledger
(`.kore/state/ledger.jsonl`, shared by every worktree) and reports, per stage of
the delivery loop, active seconds, waiting seconds (waiting on a person counts),
event count, toil, work in progress and lead time, then names the bottleneck: the stage with the largest share of
all waiting. Flags: `--min-ideas N` (default 3), `--as-of TIME`, `--since TIME`,
`--until TIME`, `--idea N[,N...]`, `--ledger PATH`.

Scope narrows a report so two periods or two sets of ideas compare field by
field; the shape is the same and `scope` states what was covered (`since`,
`until`, `ideas`, each `null` when not given). `--since` is inclusive and
`--until` exclusive, as in `ledger list`. Waiting, active and toil time are
clipped at the range edges, events count only inside it, and `wip` is measured
over the range itself. An idea is covered when its events, or an open issue or PR
wait, reach into the range; it is `completed`, and in `leadTime`, only when its
`issue.closed` falls inside, and its lead time is whole, not clipped. `--idea`
takes issue numbers (`12` or `#12`) and covers only those ideas; with it,
unattributed events are not counted as unmapped. Both flags together cover the
named ideas inside the range.

The stage rules are one table, `tools/harness/src/flow/stages.ts`. An event
joins an idea by issue number at read time: an issue event by its own number, a
PR event by the `idea` (`#<issue>`) it closes, a pane or session event by the
`idea` it carries on any event. Stages: an issue is in `await approval` from open
until the `ready-for-agent` label; a pane or session named `...-<role>` works
`refine`, `challenge`, `orchestrate`, `write`, `judge` or `verify` (verifier
events count only after the PR merged); a claude session with no pane is the main
session, `orchestrate`; a PR is in `merge` from open until merged; a closed issue
is `outcome`. A pane is active from `pane.spawned` or `pane.busy` and waiting from
`pane.waiting` until its next event. An open issue or PR is waiting, minus any
time a refine, challenge, write, judge or verify pane was alive, up to `--as-of`
(default now).

Toil is time an agent spent not advancing work, per stage, in seconds under
each stage's `toil`: `startingSeconds` (a session or pane start to its first
tool call), `stoppingSeconds` (its last tool event to close), `waitingSeconds`
(a pane waiting on a person) and `retryingSeconds` (a failed `tool.end` to the
next `tool.start` of the same tool). Toil overlaps active time, but the kinds never overlap each other: starting,
stopping and retrying leave out time the pane waited on a person, and starting
counts only for a life that began at `pane.spawned` or `session.start`. Each
life of a reused pane counts on its own.

Work in progress (`wip`, per stage) is how many ideas were open in the stage at
once: `peak` is the most at one moment and `average` is idea-seconds over the
seconds of the report's range, the earliest to the latest time any stage holds
an idea, so stages compare on one scale. An idea is open in a stage from its
first event or charged time there to the last, once however many panes it ran
there; ideas that close and open at the same instant do not overlap. The interval is one
span, so an idea that leaves a stage and returns counts as open between, and a
stage reached only by single events (no duration) shows `wip` 0. Lead time
(`leadTime`) runs from an idea's first event, of any kind, to its first
`issue.closed`, in seconds per idea, with `medianSeconds` and `maxSeconds`
(both `null` when none); ideas without an outcome are left out.

Cost metrics (`metrics`, report version 5) are tokens and sessions per closed
idea, from ledger events only: `token.usage` (recorded by the Stop hook from the
session transcript, as the session's cumulative input, output and cache-creation
tokens so far; cache reads are left out and a session counts its latest value
once) and `session.launch` (recorded by `session spawn` with the `role` and the
model `tier`). The hook reads the transcript incrementally: it keeps the byte
offset it reached, with the running total, in a per-session state file in the
temp directory, reads only what was added since, leaves a half-written last
line for the next stop, and records a `token.usage` only when the total grew.
Losing the state file costs one full read, not a wrong count. Only numbers are
read or stored.

Each of `tokensPerIdea` and `sessionsPerIdea` gives `currentIdea` and `current`
(the most recently closed idea), `trailingAverage` over the N closed ideas
before it (never including it, so one bad idea cannot dampen its own flag), the
`maxIncrease` threshold and `worsened`, true when `current` exceeds that average
by more than `maxIncrease` (0.25 means above 125%). Without N closed ideas
before the latest, so with fewer than N+1 closed, a metric is
`{"status": "insufficient history", "closedIdeas", "needed"}` (`needed` is N+1),
never zero. An idea with no `token.usage` is not measured, so it is left out of
the tokens metric rather than counted as zero. Cost events are neither stage
time nor unmapped. Only ideas inside `--since`/`--until`/`--idea` count, so a
narrow scope shortens the history. N is `--trailing N`, else
`cost.trailingIdeas` in `.claude/harness.json`, else 5. The file is committed
with the defaults, optional if removed, and checked before any report; its keys
are `cost.trailingIdeas`, `cost.tokensPerIdea.maxIncrease` and
`cost.sessionsPerIdea.maxIncrease` (default 0.25 each), and a bad one fails with
the file, the key and the fix. The human report prints the same numbers.

Known limits until plan 8 Step 3 lands its producers: nothing records
`issue.closed` or the `idea` link on PR events yet, so real ledgers show no
completed ideas and the report says "Not enough data". A label other than
`ready-for-agent` is counted as an unmapped event. A pane still waiting at its
last event is charged no time past it. Equal waiting ties go to the earlier
stage.

`--json` prints one object, `version` 3; any field change bumps `version`:

| Field               | Meaning                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `version`           | Shape version, `3`.                                                                                        |
| `asOf`              | Time open waits are measured to.                                                                           |
| `ideas`             | `{ total, completed }`; completed means the issue closed.                                                  |
| `minCompletedIdeas` | Completed ideas needed before a bottleneck is named.                                                       |
| `stages`            | Nine entries in loop order: `{ stage, activeSeconds, waitingSeconds, events, toil, wip }`.                 |
| `leadTime`          | `{ ideas: [{ idea, seconds }], medianSeconds, maxSeconds }`, completed ideas only.                         |
| `bottleneck`        | `{ stage, waitingSeconds, share }` (share 0 to 1), or `null`.                                              |
| `bottleneckNote`    | Always present: why `bottleneck` is `null` (too few completed ideas, or no waiting recorded), else `null`. |
| `unmappedEvents`    | Events with no stage or no idea, left out of every stage.                                                  |
| `skippedLines`      | Ledger lines that were not valid events.                                                                   |

## Status

`node skills/bin/harness.mjs status --json` is the concierge's one read-only
status call. It never writes, and prints `{ plans, ideas, ledger }`: `plans`
is the `plan active` list with open items per step; `ideas` is
`{ byState, items }`, where a state is `open` until an outcome closes the idea
as `success` or `failure`; `ledger` is `{ recent, skipped }`, the ten latest
stage events (`{ occurredAt, stage, kind, number?, idea? }`) newest first.
Of the bounded roles, only the concierge may run it.

## Rules that bite

- External processes run only through the injected runner; mutations name their
  environment and context.
- Secrets never touch disk or git in plaintext.
- Every command change updates the usage text and the README in the same change.
- New policies start in audit mode; versions are pinned exactly.
- Documents must be in [`docs/index.md`](../index.md) (ADRs, plans, and skills
  are required there; `mise run kb-check` checks).
