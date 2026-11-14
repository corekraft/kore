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

   Staged `.ts`, `.mjs` and `.js` source also runs the Semgrep rules
   (`kore-node.yaml`, the `scan-sast` task) on those files, so a finding such
   as `kore-dynamic-regexp` fails the commit with its rule and line instead of
   failing in CI. `tools/kore/.husky/sast-staged.mjs` picks the files with the
   same roots as `scan-sast` and skips tests; a commit with none skips the scan.
   Semgrep reads files from the working tree, so a partly staged file is
   scanned as it is on disk, unstaged edits included. A scan takes about three
   seconds.

   Unit runs are capped so a busy host stays usable. Both packages' vitest
   configs read `tools/kore/.husky/test-workers.mjs`: two workers, or
   `KORE_TEST_WORKERS` (a positive whole number exported in the shell; CI sets
   its own). The hook runs its tests under a host-wide semaphore
   (`tools/kore/.husky/test-lock.mjs`, `test-slot-<n>.lock` files in
   `.kore/state` of the main checkout). Its size comes from
   `tools/kore/.husky/test-slots.mjs`: idle cores (cores minus the one-minute
   load average) divided by `KORE_TEST_WORKERS`, never below one, so a busy host
   admits fewer runs; `KORE_TEST_SLOTS=<n>` fixes it. Runs past the size wait
   and print `waiting for a test slot: N in use by pid ...`. It waits up to 15
   minutes (`KORE_TEST_LOCK_WAIT_MS`), breaks a slot whose pid is gone, and on
   timeout names the holders and the files to remove. A slot whose pid is gone,
   or that predates the host's boot, is broken; one that cannot be read counts as
   held until it is a few seconds old.
   The same script skips a step that already passed. After its command exits
   0, and only when no tracked file differs from the index (`git diff --quiet`) and no
   untracked, unignored file exists (`git ls-files --others --exclude-standard`),
   it records the staged tree hash and the exact command, one file per step in
   `.kore/state/test-pass/<tree>/` of the main checkout, shared by every
   worktree. Nothing else writes a record; the guard warns on a hand edit. A
   later commit whose staged tree and step match prints "tests already passed
   at tree <hash>" and runs nothing; a changed tree is a different
   hash, and a different related-test list is a different step, so those run. A
   tree git cannot read just runs the tests. The typecheck and scans still run,
   and CI `check` still runs the full suites. A
   live `kore local up` or live spec run holds the exclusive host lease (`~/.kore/locks/host-lease.lock`, ADR
   0094): `session spawn` refuses a new writer while it is held, and a hook test
   run beside it prints `audit: host lease held by pid N` and appends to
   `host-lease-audit.jsonl` beside the test lock, without waiting yet.

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

- Tests have three tiers ([ADR 0098](../decisions/0098-unit-tests-mock-everything-outside-the-unit-and-integration-tests-gate-only-a-release.md)).
  A unit test exercises one class or function with everything else mocked, and
  is the only tier that gates a commit. An integration test runs real domains
  together without a cluster, and gates a release. A live test needs a cluster
  and runs only when asked. The move to these tiers is in progress under
  [plan 14](../../infra/plans/14-test-tiers.md): the cluster suites are live
  tests now (#372), and the unit runs still include tests that start real
  processes.
- The unit run has a budget: a test over 100 ms, a spec file over 1 s, or (once
  every list below is empty) a package run over 20 s fails, naming the test and
  its time. The `test-budget` hook (`harness hook test-budget`, run by
  `test:budget` after each unit run) reads the report the unit run's
  `BudgetReporter` writes to `test-results/unit.json`, and prints the ten
  slowest tests every run. A spec file's time counts its environment setup,
  imports, collection and tests, and the package time runs from reporter
  start, so global setup counts; Node's own boot does not. Arguments after `--`
  in `npm run test:unit -- <args>` reach the budget hook, not vitest: to run
  one spec, call `npx vitest run <file>`, which skips the budget. It
  applies only to converted code: each domain keeps `unconverted.txt` beside
  its sources, naming the source files (relative to the domain directory, one
  per line, `#` for comments) whose specs are not yet rewritten. A file is
  converted unless a list names it, so a new file is budgeted from the start;
  delete a line when its spec is converted. A line naming a file that no
  longer exists fails the check. A spec with no source file of the same name
  beside it is not budgeted.
- Each converted source file needs exactly one unit spec beside it, named
  `<name>.spec.ts`. The `unit-specs` hook (`test:specs` after `test:budget`,
  `harness hook unit-specs --package <dir>`) fails a converted file that has no
  such spec, and one that also has a `<name>.test.ts` beside it, and names the
  file. It reads the same unconverted lists as the budget, so a listed file is
  not checked. Live and docker specs (`*.live.spec.ts`, `*.docker.spec.ts`) are
  live tests and do not count. Support and fixture files (`*-support.ts`,
  `*-fixtures.ts`, `*.fixtures.ts`) and `.d.ts` files are not units and need no
  spec.
- Vitest resets mocks before each test, in both packages: a mock's calls and
  behaviour, and a spy's real method, do not carry from one test to the next
  (`mockReset` and `restoreMocks` in each `vitest.config.ts`). Do not reset
  mocks by hand in a test.
- Mocking patterns, from the `security` domain (`tools/kore/src/security`):
  - A source file is the unit; its spec is `<name>.spec.ts` beside it. Its
    exported functions are tested through the spec. Helpers inside the file
    cannot be mocked, so they run for real.
  - A collaborator in another module is an automock: `vi.mock("../config/index.js")`,
    then read it through `vi.mocked(isLocalProvider).mockReturnValue(true)`.
    Mock the barrel path, not the file behind it. Node built-ins that touch
    the outside world (`node:fs/promises`, `node:crypto`, `node:os`) and pure
    ones (`node:path`) are automocked the same way.
  - The process runner is a typed object: `fakeRunner()` wraps
    `vi.fn<Runner["run"]>` and replies from the command and its arguments.
    Fakes and fixtures a spec shares go in `<name>-support.ts` beside it (not a
    unit, so no spec of its own); a spec and its support file stay under 300
    lines, and each test under 70. Assert the whole `run.mock.calls` list, so a
    missing or extra command fails.
  - Errors from a real error class (`CommandError`) stay real; construct them
    and reject with them.
  - Time: `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime`, then
    `vi.useRealTimers()` in `afterEach`. Nothing waits on a real timer.
  - A test that needs real files, a real repository or real units together
    moves to `tools/kore/integration/` (`npm run test:integration`), not deleted.
    Example: `sops-config.spec.ts` reads the committed `.sops.yaml`.
- `npm test` (in `tools/kore`) is fast and needs no cluster.
- Live specs (`*.live.spec.ts`) create or destroy clusters. They run only
  when asked, with `KORE_RUN_LIVE=1` through the scripts in
  `tools/kore/package.json` (`test:live`, `test:live:admission`,
  `test:live:registry`). A cluster-facing `no-behaviour-change` needs a live
  run before merge; any other cluster-facing change merges behind a flag and
  needs the live run before the flag turns on (see Feature flags).
  The retired `KORE_RUN_INTEGRATION` and `KORE_INTEGRATION_ENVIRONMENT` are refused,
  naming their replacements, and `KORE_INTEGRATION_LOCK_WAIT_MS` likewise.
- Live specs test the environment `KORE_LIVE_ENVIRONMENT` names
  (default and empty: `local`); an unknown name is refused, listing the valid
  environments. A kore mutation queued behind a live holder prints the holder's
  pid, worktree and lock path, then waits ten minutes (`kore local up` thirty,
  since a first-time `up` takes 15 to 20); `KORE_LOCK_WAIT_MS` overrides both.
- The `nightly` workflow (`.github/workflows/nightly.yml`) runs a clean
  `kore local up` and every `test:live*` suite against one cluster through
  `tools/kore/scripts/nightly.sh`, purging the profile last. It brings up a
  scratch `nightly` environment (a copy of `local` with its own cluster) whose
  secrets are generated and encrypted to an age key made for the run, held in
  memory only, so the runner needs no stored credential; the job summary records
  duration and peak memory. Its run conclusion is the status on main. It runs on the hosted `ubuntu-latest` runner and needs GNU
  `timeout` (`gtimeout` from coreutils on macOS); a self-hosted runner is the
  fallback ([ADR 0093](../decisions/0093-the-nightly-live-proof-runs-on-a-hosted-linux-runner-under-bounded-timeouts.md)).
  `ProcessRunner` kills a command past its timeout (helm mutations get twice
  their `--timeout` plus a margin) and names it; kubectl reads carry
  `--request-timeout`.
- Upstream chart and container checks are opt-in too (`test:upstream-charts`,
  `test:container-smoke`).
- The agentgateway install is proven live by
  `KORE_RUN_AGENTGATEWAY_PROOF=1 tools/kore/scripts/agentgateway-live-proof.sh`.
  It runs a scratch copy of the local overlay with `ingress-agentgateway` on,
  kept out of git and removed on exit, so the flag stays off in the repository.

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
events count only after the PR merged); a claude session no agent name reaches is the main
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

Cost metrics (`metrics`) are tokens and sessions per closed
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

`--json` prints one object, `version` 6; any field change bumps `version`:

| Field               | Meaning                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `version`           | Shape version, `6`.                                                                                        |
| `asOf`              | Time open waits are measured to.                                                                           |
| `ideas`             | `{ total, completed }`; completed means the issue closed.                                                  |
| `minCompletedIdeas` | Completed ideas needed before a bottleneck is named.                                                       |
| `stages`            | Nine entries in loop order: `{ stage, activeSeconds, waitingSeconds, events, toil, wip }`.                 |
| `leadTime`          | `{ ideas: [{ idea, seconds }], medianSeconds, maxSeconds }`, completed ideas only.                         |
| `bottleneck`        | `{ stage, waitingSeconds, share }` (share 0 to 1), or `null`.                                              |
| `bottleneckNote`    | Always present: why `bottleneck` is `null` (too few completed ideas, or no waiting recorded), else `null`. |
| `unmappedEvents`    | Events with no stage or no idea, left out of every stage.                                                  |
| `attribution`       | `{ events, withIdea, withIdeaAndStage }`: how many events the report can place.                            |
| `guardBlocks`       | `[{ rule, blocks }]`, most blocked first, from `guard.block` events.                                       |
| `outcomes`          | `{ mainRed, reverts, liveRuns, ownerMinutes }`, see below.                                                 |
| `skippedLines`      | Ledger lines that were not valid events.                                                                   |

### Attribution and outcome metrics

`session spawn --idea N` stamps `KORE_IDEA=#N`, and always `KORE_AGENT=<name>`,
into the new pane's environment (`herdr pane split --env`). Every event a hook
records in that pane carries them as `idea` and `agent`, so the report maps the
pane's events to a stage by its role suffix and to its idea. The stamp is set
by the harness at spawn, not typed by the agent. A claude event with no agent
takes the name its pane was last given by a herdr event, so older ledgers map
too; a claude session still unnamed is the main session, `orchestrate`.
`attribution` counts the events in range (cost events and the repository-wide
events below left out) that have an idea, and an idea and a stage, from the
moment sessions began carrying the stamp: `since` is the first claude event that
names its agent, and is `null` until there is one. Events recorded before that
cannot carry a stamp, so they stay unattributed and are not counted against the
figure.

A blocked tool call records a `guard.block` event whose `label` is the rule
name, never the command; `guardBlocks` counts them per rule. The event id holds
a hash of the session, rule and call, so retrying the same blocked call counts
once.

`outcomes` holds figures whose inputs agents do not write. `ledger poll-github`
records them from GitHub, beside the issue and PR events, and `ledger record`
refuses source `github` and these kinds, so only the poller writes them:

- `mainRed`: `{ runs, failed, rate }`, failed `check` workflow runs on `main`
  over every concluded one (`ci.main`; only runs started by a push). Anything
  but success counts against, cancelled and never-started runs included. A run
  that was re-run is recorded by its first attempt, so a failure re-run to
  success is still seen.
- `reverts`: `{ reverts, merged, rate }`, commits on `main` whose subject starts
  with `Revert "` or whose body says `This reverts commit` (`main.revert`) per
  merged change. A PR merely titled Revert does not count.
- `liveRuns`: `{ runs, passed, rate }`, the pass rate of the `nightly` workflow's
  clean `local up` and live runs (`ci.nightly`; only scheduled runs, so a
  run an agent dispatches by hand is not counted; first attempt, as above).
- `ownerMinutes`: `{ minutes, merged, perMerged, burstGapMinutes, upperBound }`.
  The owner login's comments, issue events and PR reviews (`owner.action`) on
  idea issues and on pull requests that close one, less than `burstGapMinutes`
  (10) apart, form one burst, charged from its first to its last action, at
  least one minute. `perMerged` is `minutes` over merged changes. The login is
  `ownerLogin` in `.claude/harness.json`, else the repository's owner; there is
  no flag to override it. Agents share that login until they get their own
  identities (#336), so `upperBound` is always `true`.

A listing too long to page through (200 runs or PRs, or 300 comments, events or
commits) fails the poll instead of recording part of it: pass `--since` to bound
a first poll. Later polls start a day before the latest recorded signal, and
`--since` can only reach back past that, never later, so it cannot step over a
failed run.
Each rate is `null`, never zero, when nothing was measured, and each counts only
events inside `--since`/`--until`. Only counts, conclusions and times are
stored, never a title, body or login.

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
