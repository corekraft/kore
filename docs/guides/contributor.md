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
   specs that name its directory (`tools/kore/.husky/related-tests.mjs`). To run the same
   typecheck, lint and related tests by hand, without a commit, use
   `mise run test-related <files>`; it runs every step and reports each failure. The
   full suites with coverage thresholds run in CI `check`, which the `main`
   ruleset requires before merge (changes to that ruleset go through
   `harness ruleset sync`, previewed first and confirmed once the operator
   agrees (`harness ruleset sync --help` names the steps); a changed rule starts in the `main-candidate` ruleset, ADR 0090); run them locally with `mise run test`. The
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
   configs read `tools/kore/.husky/test-workers.mjs`, run the threads pool
   (`pool: "threads"`), and start two workers on any host, CI included.
   `KORE_TEST_WORKERS` (a positive whole number exported in the shell)
   overrides it on a local host, for example for a run that wants more
   workers than a live cluster on the same host leaves room for (#405). The
   hook runs its tests under a host-wide semaphore
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
  tests now (#372), and the script, hook, status line and bundle tests run in
  the integration tier (#373). A pull request that touches only `.claude/` files
  other than hooks and evals, `skills/` or `.codex/` runs no hook test before
  merge; the nightly integration job covers them after merge (owner decision).
- The unit run has a budget: a test over 100 ms, a spec file over 1 s, or (once
  every list below is empty) a package run over 2 min fails, naming the test and
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
  `harness hook unit-specs`, its package named in `harness hook unit-specs --help`) fails a converted file that has no
  such spec, and one that also has a `<name>.test.ts` beside it, and names the
  file. It reads the same unconverted lists as the budget, so a listed file is
  not checked. Live and docker specs (`*.live.spec.ts`, `*.docker.spec.ts`) are
  live tests and do not count. Support and fixture files (`*-support.ts`,
  `*-fixtures.ts`, `*.fixtures.ts`), live helpers (`*.live.ts`, imported only
  by live and opt-in suites) and `.d.ts` files are not units and need no spec.
  Live helpers are excluded from unit coverage too.
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
    Fakes shared by a domain's specs go in one domain-level `<domain>-support.ts`
    (not a unit, so no spec of its own), with `fakeRepository()` for the
    repository. Fixtures only one spec uses go in `<name>-support.ts` beside it.
    Each spec and each support file stays at 300 code lines or fewer
    (`max-lines`): blank lines and comment-only lines do not count, so a file of
    315 raw lines with 300 code lines is at the limit. `harness pr check` reports
    a file over it as an audit item. It also reports each type cast (`as never`,
    `as unknown as`, any other `as T`) on a line the PR adds to a TypeScript file,
    tests included, with its file, line and fix; `as const` and an import or export
    alias are not casts. It reports each GitHub closing keyword (`Close`, `Fix`,
    `Resolve` and their forms) with an issue reference in the PR body, beside an
    `Idea:` line, with the fix `Refs`. All of these are audit items, never a
    failure. Each test function stays under 70 lines
    (`max-lines-per-function`). Assert the whole
    `run.mock.calls` list, so a missing or extra command fails.
  - Errors from a real error class (`CommandError`) stay real; construct them
    and reject with them.
  - Time: `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime`, then
    `vi.useRealTimers()` in `afterEach`. Nothing waits on a real timer.
  - A test that needs real files, a real repository or real units together
    moves to `tools/kore/integration/` (`npm run test:integration`), not deleted.
    Example: `sops-config.spec.ts` reads the committed `.sops.yaml`.
- Mocking patterns in the harness (`tools/harness`), as the `guardrail` domain
  settled them. They follow the kore pattern above, except where noted:
  - Integration specs live in `tools/harness/integration/<domain>/` and import
    the domain through its barrel (`../../src/<domain>/index.js`), like the
    harness's other integration specs.
  - The harness has no shared runner fake. A domain's `<domain>-support.ts`
    builds a typed `CliDeps` whose every member is a `vi.fn` (the `guardrail`
    domain's `fakeDeps()`). The `testing` domain's in-memory file system is a
    stateful fake, so unit specs do not use it.
  - A partly real module keeps its error classes and constants real through a
    partial mock: `vi.mock(path, async (importOriginal) => ({ ...(await
importOriginal()), fn: vi.fn() }))`.
  - A barrel's spec (`index.spec.ts`) automocks the files it re-exports and
    checks the names it exposes and that each is its module's own export.
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
  their timeout plus a margin) and names it; kubectl reads carry
  `--request-timeout`.
- Upstream chart and container checks are opt-in too (`test:upstream-charts`,
  `test:container-smoke`). They are integration specs in `tools/kore/integration/`
  that run helm and docker, so the unit run never starts them.
- The agentgateway install is proven live by
  `KORE_RUN_AGENTGATEWAY_PROOF=1 tools/kore/scripts/agentgateway-live-proof.sh`.
  It runs a scratch copy of the local overlay with `ingress-agentgateway` and
  `gateway-class-change-release`, `gateway-rollback-order` and
  `agentgateway-mesh-enrollment` on, then sends a request through the Gateway to
  the reference route and expects 200 (phase 4 expects the first rollback
  `kore local up` to fail with the gated-off refusal after converging),
  kept out of git and removed on exit, so the flag stays off in the repository.
- Whether the Gateway serves a TLS passthrough and an HTTPS listener on one port,
  and a listener set, is probed by
  `KORE_RUN_AGENTGATEWAY_PROBE=1 tools/kore/scripts/agentgateway-listener-probe.sh`
  on a throwaway cluster with only the controller and the Gateway API
  definitions ([the probe](../operations/agentgateway-listener-probe.md)).

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
  `mise run harness-build` in it; `session spawn` does this itself for a worktree (`harness session spawn --help` names its options).
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
   `node skills/bin/harness.mjs outcome record`, with the idea, the verification kind, the live-run source, the result, the flag, its environment, the evidence and a summary (`harness outcome record --help` names each option).
   When the owner has waived the live run in a GitHub comment, record the waiver
   instead, with the owner-waiver source and the comment as evidence (verification
   only, [ADR 0127](../decisions/0127-an-owner-waiver-recorded-in-an-outcome-counts-as-proof-for-a-flag.md));
   a waiver never stands in for the live run a cluster-facing
   `no-behaviour-change` needs before merge.
   A proof that ran on a main chart lock also names the main lock and each
   handed-over chart with its version and digest, copied from that lock (`harness outcome record --help` gives the form; [ADR 0138](../decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md)).
3. `node skills/bin/harness.mjs flag activate <name>` for one environment, which `harness flag activate --help` names, edits
   the overlay only when that confirmed outcome exists, and records a
   `flag.activated` ledger event. Without proof it refuses and changes nothing.
   A main-lock proof counts only when the release's lock, given to activate,
   has the same version and digest for every recorded
   chart; otherwise it refuses, names the charts that differ and says to
   re-prove. A proof with no lock, a release lock or an owner waiver is not
   compared.
4. `flag audit` exits 1 when any flag is on without proof, and lists each flag
   that rests on an owner waiver rather than a live run. `kb-check` runs it
   and reports a warning, which never fails a strict run (ADR 0080: audit before
   enforce); the `flag-activation` guard also warns on a hand edit.
5. Removing the flag, its overlay entries and its gated code is the contract step of
   expand-contract, after the outcome is confirmed.

## Evaluating a harness idea

`node skills/bin/harness.mjs evaluate` closes the loop on a `kind: harness` idea, named by its number; `harness evaluate --help` names its options ([plan 12](../../infra/plans/12-self-improving-loop.md), Step 3).
The change date is the idea's first `pr.merged` ledger event (the PR whose `idea` is
`#<issue>`, or the PR the command is told is the change, when the ledger ties none). Once
the hypothesis `window` has elapsed, it reads the hypothesis metric from the flow
report over that window after the change and over the equal window before it, so no
agent supplies the figure. A move in the expected direction of at least the
threshold (default 10%) records `confirmed`, the opposite `refuted`, and anything
inside the noise, or a window the ledger recorded nothing in, `inconclusive`: missing
history is never `confirmed`. The result goes only through `outcome record`, so the
comment, the one `outcome:*` label, the close and the ledger `outcome` event follow
from the outcome tool. An inconclusive change stays in place and is flagged by its
`outcome:inconclusive` label and its follow-up idea. A refuted one is recorded and then
reverted, behind the `automatic-revert` flag (off in every overlay; a person turns it
on after a recorded outcome): `evaluate` reverts the merged PR in a throwaway
worktree off `main`, pushes `revert/idea-<issue>` and opens a revert PR whose body
declares `Safety pattern: no-behaviour-change` and `Refs` the idea's issue. It never
merges or approves it: the judge and merge tool take it like any change. It appends
one `harness-change-reverted` ledger event (the revert PR's number), and the outcome
tool has already opened the follow-up idea. A rerun prepares nothing more: the ledger
event, or a PR already on that branch, stops it. A change that edited
`.claude/guardrails.yaml` is not reverted this way, because a guardrail must never go
straight back to enforce; request the mode change with `harness guardrail request` (`harness guardrail request --help` names its options). With the flag off it prints that no revert was prepared. Before the window ends it exits 1
and prints when it can run; an idea with an outcome is left as recorded, so reruns
never overwrite. Its JSON form, in `harness evaluate --help`, prints `status` (`recorded`, `too-early` or
`already-recorded`) with `idea`, `result`, `before`, `after`, the outcome and, once
recorded, `revert` (`status` and, when a PR exists, `number` and `url`).

## Flow report

`node skills/bin/harness.mjs flow report` reads the stage ledger
(`.kore/state/ledger.jsonl`, shared by every worktree) and reports, per stage of
the delivery loop, active seconds, waiting seconds (waiting on a person counts),
event count, toil, work in progress and lead time, then names the bottleneck: the stage with the largest share of
all waiting. Its options, with their defaults, are in `harness flow report --help`.

Scope narrows a report so two periods or two sets of ideas compare field by
field; the shape is the same and `scope` states what was covered (`since`,
`until`, `ideas`, each `null` when not given). The lower bound is inclusive and the upper
exclusive, as in `ledger list`. Waiting, active and toil time are
clipped at the range edges, events count only inside it, and `wip` is measured
over the range itself. An idea is covered when its events, or an open issue or PR
wait, reach into the range; it is `completed`, and in `leadTime`, only when its
`issue.closed` falls inside, and its lead time is whole, not clipped. The idea option
takes issue numbers (`12` or `#12`) and covers only those ideas; with it,
unattributed events are not counted as unmapped. Both options together cover the
named ideas inside the range.

The pane figures read per ledger source (#1782). `finishDetection`, `stalledPanes` and
`leadTime` at the top level read the herdr source: every event a herdr line wrote, and any pane or session
no terminal event names. A ledger with no `source: "terminal"` event reads as herdr alone, and `terminal`
is `null`. Once one is present, `terminal` holds the same readings over the terminal source (`finishDetection`,
`stalledPanes`, `leadTime` and `mainSession`), and the text prints each figure once per source, labelled
and never blended. A pane or session is read as terminal when the ledger records a terminal event on it; an
idea reads under the source of its first pane or session event. The retro scan counts herdr pane reads and
does not split its sends by source, so `mainSession.paneReadsPerFinishedPane` reads the herdr source only,
and `mainSession.signedSendShare` is insufficient once a terminal source is present; the terminal reading of
both is insufficient with its reason. Merged-change figures, tokens and the other figures are not split. A
terminal's finish is noticed almost at once and its stall is a blocked or error event, so compare each source
with its own history. The `terminal` key is not a hypothesis metric until an idea names one. Report version 41
added `terminal`.

`tierShares` in the JSON form (report version 9) gives, per role, the launches by
`tierSource`, with launches from before it was recorded as their own `unknown`
group, and the override share over the launches that know their source, so tier
tuning can read only definition and escalation launches.

Host pressure comes from the `host-sample` events each session spawn records.
`hostPressure` in the JSON form (and one short section in the human report) gives, per
live-session count and split by whether the local platform was up, the sample
count and the median and peak of swap (bytes) and load. Each median is compared
with the median of the same level over the days before the range (`harness flow report --help` names the window)
(default 7; before the as-of time when the range has no start), and `worsened` is set
when it is above that median by more than the spread (population standard
deviation). Fewer than three baseline samples give `insufficient history`. A
reading a host could not give is left out of the figures, and a range with no
samples says so (`samples` 0, no levels).

The advisor's figures ([ADR 0120](../decisions/0120-recommended-decisions-go-to-an-advisor-reserved-decisions-to-the-owner.md),
#862) read `decision.made`, `decision.routed` and `advisor.overturned` events.
`advisorQuality` in the JSON form gives the decisions made and overturned in the range,
`perMade` (overturned over made, to four places, `null` when none was made), the
`refutingShare` (a placeholder, 0.07) and `refuted`. `ownerRoutes` gives the owner
and advisor route counts and the owner-routed questions per signal, every owner
signal present. `waitingOnPerson` gives the seconds questions waited on a person,
apart from every stage's waiting: a question waits from its `owner.asked` until
the same pane or session next acts, or until the range's end or the as-of time when it
never does. `ledger poll-github` records an overturn as the owner login's first
untagged comment after each advisor decision on that issue; a tagged comment, and
the harness's approval markers, are never one. A `decision.made` event records the
issue it was posted on from this change on; one recorded before it has no issue, so
its overturns are not read and it counts as made only.

The handover count (spec [#1031](https://github.com/corekraft/kore/issues/1031),
#1036) reads the `session.send` events the main session wrote with a `handover`
reason: why it passed a case to the stronger session by a pane message. The reasons
are a fixed list (`reserved-item`, `needs-info-idea`, `third-send-back`,
`owner-request`, `flag-activation`, `unmapped-message`); a reason outside it is
refused, so no message text reaches the ledger. Only sends with no sender role
count. `handovers` in the JSON form gives the count over the range, `merged` and
`byReason`, every reason a key, zero where none. It is a reading, not a guard:
nothing blocks a send. A range with no send that names a reason, or with fewer
merged changes than `cost.minMergedChanges`, is `insufficient` with its reason,
never zero. No `session send` option records a reason yet, so the count stays
insufficient until one does.

The compaction count (spec [#1027](https://github.com/corekraft/kore/issues/1027),
#1037) reads the `session.compacted` events. `hook record session-start` writes one
when a session starts with the `compact` source, holding the session's name and the
compaction's number (the `compaction` field, a whole number from 1) and no text; a
startup, clear or resume start writes none. The number is the count of compact
summary lines the session's transcript holds, and the event's id names session and
number, so replaying the same start record writes nothing a second time. A start
whose transcript cannot be read, or holds no compact summary yet, writes nothing.
`compactions` in the JSON form gives `compactions` over the range, `sessions` seen in it
and `perSession`, every session seen a key, zero where it never compacted. A range
with no session is `insufficient`, never zero.

The main-session setup label (spec [#1027](https://github.com/corekraft/kore/issues/1027),
#1046) says which setup a stretch of main-session work ran under. It is computed
when the report reads, from the `token.split` readings of sessions with no role and
the `compactionCap` of `.claude/harness.json`; nothing writes it to the ledger and
no flag or option can type it. A stretch is one main-session session on one recorded
model, with the largest prompt in its readings before the range ends. Its label is
`control` (the main-session model, `claude-opus-5-5`, with a largest prompt above
the cap), `early compaction` (the same model, at or under the cap) or `Haiku` (a
Haiku model). With no cap set, a stretch that has a reading reads `not set`,
whatever its model, Haiku included. With a cap, a model that is neither reads
`insufficient` with a `reason`. A session with token totals and no reading (whose
`model` and `largestPrompt` are `null`) reads `insufficient` with a `reason`
whatever the cap. `mainSessionSetups`
in the JSON form gives `status`, `compactionCap` (`null` when not set) and `stretches`;
a range with no main-session reading is `insufficient` with its `reason`. The text
prints a `Main-session setups` line with the cap, then one line per stretch. The
cap's value is the owner's to set; the report never guesses one.

The person's main session answers "how is the loop doing?" from this report alone
(the JSON form of `flow report`, no code or transcripts read, no file written): it leads
with every metric whose `worsened` is true, names current against trailing
average, and reports `insufficient history` or an absent field as such, never a
figure the report did not print. A boundary eval case with
`expectCommand` fails when the run never calls the report
(`.claude/evals/boundary.json`).

The stage rules are one table, `tools/harness/src/flow/stages.ts`. An event
joins an idea by issue number at read time: an issue event by its own number, a
PR event by the `idea` (`#<issue>`) it closes, a pane or session event by the
`idea` it carries on any event. Stages: an issue is in `await approval` from open
until the `ready-for-agent` label; a pane or session named `...-<role>` works
`refine`, `orchestrate`, `write`, `judge` or `verify` (verifier
events count only after the PR merged); a claude session no agent name reaches is the main
session, `orchestrate`; a PR is in `merge` from open until merged; a closed issue
is `outcome`. A pane is active from `pane.spawned` or `pane.busy` and waiting from
`pane.waiting` until its next event. An open issue or PR is waiting, minus any
time a refine, write, review, judge or verify pane was alive, up to the as-of
time (default now).

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
model `tier`, and, since the tier source was recorded, `tierSource` (definition, escalation or override) and, for an override given with a reason, `tierReason`; older launches have neither and read as unknown). The hook reads the transcript incrementally: it keeps the byte
offset it reached, with the running total, in a per-session state file in the
temp directory, reads only what was added since, leaves a half-written last
line for the next stop, and records a `token.usage` only when the total grew.
The same read also records `token.split` (#1001): for each model, the requests and
their input, cache-write (5 minute and 1 hour), cache-read and output tokens, split
by the prompt step the request's prompt fell in (at or under 100,000 tokens, or over
it, cache reads and writes counted in the prompt), and the first request's prompt
size. It holds numbers and the model name only, and it is written only for a model
whose counts grew. Prices are in `tools/harness/src/flow/writer-prices.ts`.
Losing the state file costs one full read, not a wrong count. Only numbers are
read or stored.

Host pressure is recorded by `session spawn` as one `host-sample` event per
spawn, after the `session.launch` event: the 1-minute `load`, free `memory` as a
share of total, `swap` in bytes, the `sessions` live in herdr, and whether the
local `platform` was up (the local journal's last operation is not a stop, down
or destroy and did not fail). A reading the host cannot give (no load, a failing
`memory_pressure`, `sysctl` or `free`) is left out of the event, never stored as
zero. A failed reading or append never blocks the spawn. `harness ledger list` shows them, filtered as its help (`harness ledger list --help`) describes.

Each of `tokensPerIdea` and `sessionsPerIdea` gives `currentIdea` and `current`
(the most recently closed idea), `trailingAverage` over the N closed ideas
before it (never including it, so one bad idea cannot dampen its own flag), the
`maxIncrease` threshold and `worsened`, true when `current` exceeds that average
by more than `maxIncrease` (0.25 means above 125%). Without N closed ideas
before the latest, so with fewer than N+1 closed, a metric is
`{"status": "insufficient history", "closedIdeas", "needed"}` (`needed` is N+1),
never zero. An idea with no `token.usage` is not measured, so it is left out of
the tokens metric rather than counted as zero. Cost events are neither stage
time nor unmapped. Only ideas inside the since and until bounds, or the idea option, count, so a
narrow scope shortens the history. N is the trailing option's value, else
`cost.trailingIdeas` in `.claude/harness.json`, else 5. The file is committed
with the defaults, optional if removed, and checked before any report; its keys
are `cost.trailingIdeas`, `cost.minMergedChanges` (a placeholder, default 5),
`cost.minCategorisedSendBacks` (a proposal, default 20; see `sendBackCategories` below),
`cost.tokensPerIdea.maxIncrease` and `cost.sessionsPerIdea.maxIncrease` (default
0.25 each), and a bad one fails with
the file, the key and the fix. The human report prints the same numbers. Read `sessionsPerIdea` beside the closed-idea count behind it, because it sets the latest closed idea's sessions against the average of the closed ideas before it, and with too few closed ideas the report gives `closedIdeas` and `needed` in place of a figure.

`tokensPerMergedChange` is read per window, not per closed idea (#829).
`current` is the tokens spent inside the range and the merged changes (its
`pr.merged` events) in it, with `perMerged` as their ratio, rounded to four
places. Each session's `token.usage` is cumulative, so its spend in the range is
its last count before the range's end less its last count before the range's
start. `trailingAverage` is the same figure over the 7 days before the range, or
before the as-of time when the range has no start. A span with fewer merged changes
than `cost.minMergedChanges` is `{"status": "insufficient merged changes",
"merged", "needed"}`, never zero, and the trailing average is read the same way.
That minimum defaults to 5, a placeholder until it is re-checked from data
(#808).

`sendBacksPerMergedChange` is read per window the same way (#830). Its `current`
and `trailingAverage` give `perMerged` as the send-backs in the range over its
merged changes, with `sendBacks` the send-backs counted, each PR head once
whatever its category. `leadTimePerMergedChange` gives the median, in whole
seconds, of each merged change's time from its pull request's opening to its
merge, as `medianSeconds`, with `measured` the merged changes that had an
opening. The opening is the ledger's `pr.opened` event for that PR number; when
the ledger has none, the `pr.merged` event's own `openedAt` is used, which
`ledger poll-github` records from GitHub on every merge it appends from #830 on.
A merge with neither is counted as merged but not measured, and so are merges
from before either was recorded. Both figures need `cost.minMergedChanges`
merged changes (measured, for the lead time) to be read, else they are
`{"status": "insufficient merged changes"}` with `merged`, `measured` where
they apply, and `needed`, never zero.

`tokensByStage` is the tokens spent in the range, split by stage (#831): every
stage is a key, zero where it spent nothing. A session's spend goes to the stage
its launch stamped, else its role's stage, else `orchestrate`, so a session with
no role counts there. A session's spend is its last count at the range's end
less its last count before the range's start, as for `tokensPerMergedChange`,
so the stages add up to that figure's `tokens`. `tokensByStagePerMergedChange` gives each stage's
tokens over the range's merged changes as `perMerged`, rounded to four places,
with `merged`, and a `trailingAverage` over the 7 days before the range, read
the same way. It needs `cost.minMergedChanges` merged changes, else it is
`{"status": "insufficient merged changes"}` with `merged` and `needed`, never
zero. Its names are the figures themselves, `tokensByStagePerMergedChange.current`
and `.trailingAverage`; a stage's own value sits inside `perMerged`.

`writerCost` prices the writers by tier (#868, parent #825). Each writer launch
records its model as `tier`; a writer on a model the price table does not know is
left out of every tier. A writer counts in the range when it launched in it or
spent tokens in it. Its tokens in the range are weighted by the model's input
price relative to `claude-haiku-5-5`, from the table in
`tools/harness/src/flow/writer-prices.ts`, pinned with its `pricesAsOf` date. The
ledger's token count adds input, output and cache-creation tokens together, so the
weight is relative rather than dollars. Output is five times input for every model in
the table, but cache reads and writes are not, so a tier's dollar cost depends on its
token mix; the dollars below price each part. Each tier gives `sessions`,
`weightedTokens`, `mergedChanges` (the merged changes joined to that tier) and
`perMergedChangeByTier` (its weighted tokens over its own `mergedChanges`, null with
none); its all-in dollars per merged change are in the paragraph below. A merged change joins to a
tier through its pull request's `pr.linked` event: the writer's first priced
launch's tier, or, when that launch carries an idea, the tier of the earliest
priced launch with that idea. A merged change with no link, or whose linked
session has no priced launch, is `unjoinable` and in no tier; the figure states
`relaunchLimit`, the limit of the join (`tools/harness/src/flow/writer-join.ts`).
`followUpsPerSession` (sends to that tier's writer panes over its sessions, null
with none), and `finished`, `blocked` and `blockedShare`: a writer is finished when
it has a `session.result`, and blocked when its latest result is `blocked`. The
`orchestrate` entry weights the main session's tokens at `MAIN_SESSION_MODEL` in
`tools/harness/src/flow/writer-usage.ts`, because its `token.usage` records no model;
re-check that assumption before reading the tiers against it. Its dollars are read
in the all-in paragraph below (#1041).
`writerCost.current` and `.trailingAverage` are the names the figure registers;
each has `status` and needs `cost.minMergedChanges` merged changes, else it is
`insufficient merged changes`, never zero.

The headline token cost beside waiting time (#1019) is `costWaiting`, read at the
published prices against the cost settings and the weekly token ceiling in
`.claude/harness.json` (`weeklyTokenCeiling`, a top-level key beside `cost`, read `not set` when it is
absent; the owner sets its value). It has three levels. `mergedChanges` reads insufficient, never zero, below `cost.minMergedChanges`
joined changes, and each `agents` role reads insufficient below that many sessions; `ideas` is a plain list, one
row per idea named by an event or carried by a linked writer's pull request, with no insufficient status; the `writing` share reads insufficient below the same count, of writer sessions. An unpriced model is named, never read as zero: `agents` and `mergedChanges` read `insufficient prices` with the models (checked before the minimum, and for `mergedChanges` over the joined changes and the shared judge and orchestrating spend), and an idea with one has null dollars and `unpricedModels`, its tokens still counted; the text prints `<role> not read: no price for <models>` for an agent row and `insufficient prices (models)` for the merged-change line and an idea row. `agents` (per role: writer, reviewer, judge, verifier,
reader, judgment, advisor, the main session as `orchestrate`, and any other named
session as `other`, each with its sessions' dollars, tokens, active and waiting seconds
as median and p90); `mergedChanges` (the text
prints one summary line of the joined count with the median and p90 of all-in dollars
and tokens; The JSON form adds one row per merged pull request, with its all-in dollars and
tokens by the same attribution, its seconds from the first writer launch to merge, and
its seconds from opening to merge); `ideas` (the
dollars and tokens of the sessions stamped with each idea to the window's end, plus the
writers whose pull request carries the idea, its lead time and outcome); and `writing`
(#1093, spec #1086, ADR 0126), below; and `ceilingShares` (#1048, spec #1030), below.
The report names no winner and no verdict. Code: `tools/harness/src/flow/cost-waiting*.ts`.

`ceilingShares` reads each level's plan-weighted tokens against the weekly ceiling, with a
fixed meaning per level. Plan-weighted tokens are each model's tokens times its price weight
(`plan-tokens.ts`, one weight per prompt step, Haiku's high step included); a model with no weight is
named as `insufficient weights`, never read as zero, and the weights approximate the plan's own,
which the harness cannot read. `ceiling` is `weeklyTokenCeiling` or `not set`; with none, every measured
share, total, median and p90 reads `not set`, never zero, while a row or level that is not read still
says why (`insufficient` with its units and needed, or `insufficient weights`). The owner sets the value; no build sets it.

- `agents` is a rate, labelled `of the weekly ceiling`: a role's plan-weighted tokens in the 7
  days ending where the window ends (as-of when the window has no end) over the ceiling. A role with fewer than `cost.minMergedChanges` sessions in those 7 days is
  `insufficient` (units and needed), not a zero share. The main session, `orchestrate`, also counts the token totals of
  sessions with no recorded model, priced at the assumed model's input weight, a floor, and carries `basis`:
  `assumed model` (or `recorded and assumed model`) until its model is recorded.
- `mergedChanges` and `ideas` are sizes, labelled `of one week's ceiling`: a change's all-in plan-weighted
  tokens (the #1008 attribution read at the plan weights) or an idea's total over one week's ceiling,
  with `spanSeconds` beside the share (a change: first writer launch to merge; an idea: first to last
  event stamped with it). A change no writer launch joins has a null share.

The two kinds are never in one column. A level's `total` is its rows' shares summed and may be above
100%, because agents overlap in time; `median` and `p90` are over the rows' shares. A level below its
minimum count (`agents`: one role read; the others `cost.minMergedChanges` units) is `insufficient`,
never zero. The text prints a `Shares of the weekly token ceiling` block after the idea lines. Code:
`cost-waiting-ceiling-shares.ts` and the `cost-waiting-shares-*.ts` files beside it.

`writing` reads writer tokens by where they land. A writer session is one with a
`session.launch` as a writer and a `token.split` reading in the window; its tokens and
dollars are its cumulative readings to the window's end. A session whose readings carry an
idea (other than `none`) is already in that idea's figure, so it is counted as `attributed`
and never added again. Any other session is charged whole to the idea on its earliest
`pr.linked` event: a link that names an idea carries it (a bare issue number is read as
`#n`, the form stamps and the poll use); a link that names `none` carries none; a link with
no idea recorded (from before the field) takes the idea the GitHub poll set on the pull
request from its closing references, if any. A session charged to an idea is added to that
idea's row in `ideas` and counted in `attributed`. The other two buckets are never added to
an idea: `noIdea` (linked to a pull request that carries none) and `noPullRequest` (no
`pr.linked` event). Each bucket has `sessions`, `tokens` and `dollars`, with null dollars
and `unpricedModels` when a model is not in the price table, tokens still counted.
`unjoinable` counts the pull requests opened in the window with no `pr.linked` event, so
history before the link event reads as a count, not as no writing. `share` is the
attributed tokens over all writer tokens in the window, or `insufficient` with `sessions`
and `needed` below `cost.minMergedChanges` writer sessions (or with no tokens), never zero.
The text prints four lines after the merged-change line: the share, the two buckets and
the unjoinable count; an unpriced bucket prints `insufficient prices (models)`. The share is
a reported reading, not an idea's primary metric (ADR 0119). A link's idea names the link
event itself only: `flow/attribution.ts` does not spread it to the writer's other events,
so idea 0012's attribution reading moves by one event per pull request (pinned in
`tools/harness/integration/flow-writer-ideas.spec.ts`).

The all-in dollars per merged change (#1008) are `perMergedChangeDollars` on each
tier, priced per request from `token.split` readings (`tools/harness/src/flow/writer-dollars.ts`):
each model's counts at the low step and the high step (over 100K, the whole request
at the high step, cache reads included) at its rates from the table, with the price
table passed in as a parameter. A change's writer part is its writer sessions'
whole-life dollars to the last of their merges, split equally across the merged
changes each session is linked to; its reviewer part is the session named
`pr<N>-reviewer`, to its merge; the judge's and orchestrating sessions' spend in the
span, the reviewers excluded, is shared equally per merged change. The tier reads the
mean of each part, the sum (`allIn`) and the median of the per-change totals, which
the parts do not sum to. The orchestrating part is the main session's spend (#1041,
`tools/harness/src/flow/writer-orchestrate.ts`): each model with a `token.split` reading
in the span is priced from that reading's growth at its own rates and prompt steps, so a
Haiku reading and an Opus reading in one span are each priced as their own model. A
main-session session with `token.usage` totals and no reading in the span has no recorded
model, so its totals (input, output and cache creation) are priced at the assumed
`MAIN_SESSION_MODEL`'s input rate, a floor, and the figure says so. `orchestrate.model`
is that assumed model, `orchestrate.assumedTokens` the tokens priced at it,
`orchestrate.recordedModels` the models read, and `orchestrate.basis` one of `recorded`,
`assumed model`, `recorded and assumed model`, or `none` (no main-session tokens); an
unpriced model reads `insufficient prices`, naming it. A session with a role is never read
as the main session, and no main-session dollars are assigned to a pull request. `judge` and `orchestrate`
give the shared dollars, and `unmergedWriterSessions` counts the writers with spend
and no merged change, left out of every tier. A model the price table does not
price, in a tier's changes or in the shared spend, makes that figure
`insufficient prices` and names the model; it is never read as zero.

Each tier also reads the figures beside its cost (#1009), from
`tools/harness/src/flow/writer-tier-figures.ts`: `rework`, the sends to its writer
panes after a judge send-back for the change its writer started (an interrupt, or a
send with no send-back before it, is not rework), and `reworkPerMergedChange` over its
`mergedChanges`; `ownerMinutes` on the tier's joined pull requests, counted as
`outcomes.ts` counts owner minutes, and `ownerMinutesPerMergedChange`; `requests` and
`over100kShare`, the share of its requests over the 100K prompt step from the
`token.split` request counts (zero when none is over the step, null with no request);
and `firstPromptP50` and `firstPromptP90`, the median and the 90th percentile (nearest
rank) of the first-request prompt sizes of its writer sessions that launched in the span
and whose first request is in it; a session launched before the span, or whose first
request falls outside it, is left out. A per-change figure is null with no
joined change, never zero, and the text reads it as not read.

`writerArms` compares the Haiku and Sonnet arms (#1012, spec #998), from
`tools/harness/src/flow/writer-arms.ts`. An arm is the merged changes joined to one tier
(`claude-haiku-5-5` or `claude-sonnet-5-5`) by the join above. For the overall figure and for
each label a change's writer carried at launch (`session.labelled`, one row per label, so a
change with two labels counts in both), it gives the difference in all-in dollars per merged
change, Haiku minus Sonnet, with a 95 percent percentile interval from a seeded bootstrap
(`tools/harness/src/flow/bootstrap-interval.ts`, over the generator in `seeded-random.ts`; the
seed, resamples and level are fixed in `writer-arms.ts` and printed with the figure). Each arm
also gives its merged changes, mean all-in dollars, effort mix (the effort of the launch the
change joins to), and the guards from
`writer-arm-guards.ts`: blocked share, send-backs and owner minutes per merged change. A row
with fewer than `cost.minMergedChanges` merged changes in either arm is `insufficient merged
changes`, and an unpriced model is `insufficient prices`; neither is ever a zero. The report
names no winner, margin or verdict: the deciding rule is the owner's, recorded on the idea
before the window opens. Only randomized launches at the window effort are in an arm (#1069,
spec #1065): a launch whose tier reason is `experiment` (the drawn Sonnet) or `experiment-control`
(the Haiku control), recorded at the window effort, read by `randomized-launches.ts`. The window
effort is set by the window-effort option (one of `low`, `medium`, `high`, `xhigh`, `max`); without it, the most
common effort among randomized launches, and `writerArms.windowEffort` says which (`from` is
`setting`, `most common` or `none`). `writerArms.excluded` counts the merged changes whose first
launch is left out, each once, by a fixed name: `missingEffort` (no recorded effort, including
every launch from before effort was recorded), then `notRandomized` (hand-picked, escalated or
overridden, on any tier), then `differentEffort` (randomized at another effort). Effort is never a
stratum, and `cost.minMergedChanges` applies to the restricted counts. The arms' wording states the
window effort ("Haiku at high minus Sonnet at high"), so a result reads at that effort only.
`writerArms.unlabelled` counts arm changes with no label, which are in
the overall figure only. `writerFiguresIn` (`writer-figures.ts`) reads the cost and the arms
against the same minimum.

`sendBackCategories` (#830, #1094, spec #1088) counts the judge's send-backs by category, once per PR
head, as `perPrHead` (every send-back in range) and `perMergedChange` (those of ideas that closed in
range). Each has `byCategory` (every category of the list a key, zero where none), and three counts that
are never added together into the share: `legacy`, the send-backs recorded before 2026-11-16, when the
send-back command began to require a category (#884), whatever they carry (neither `uncategorised` nor
`other`); `uncategorised`, the send-backs from 2026-11-16 on with no category (none is expected); and
`categorised`, the sum of `byCategory`. The cut is `CATEGORY_REQUIRED_FROM` in `send-back-share.ts`, and
a window is split at it with `splitSpanAt` (`date-split.ts`). Old send-backs are left out, not
back-filled. `otherShare` is `other` over `categorised` (null with none), and `otherReading` is
`insufficient` below `minCategorised` categorised send-backs (`cost.minCategorisedSendBacks`, default 20,
a proposal; its own setting, since `cost.minMergedChanges` counts merged changes), else `over` when
the share is above `otherThreshold` (a placeholder, 0.1) and `within` when it is not.
`otherOverThreshold` is true only for `over`, so a thin window is never over. A stored send-back line
whose category this build does not know is not read: the ledger counts it in `skippedLines`. The
per-merged-change figure `sendBacksPerMergedChange` still counts every send-back, legacy ones included.
The same counts, minimum and reading are on each `sendBackTiers` row. The text prints each scope on one
line with the legacy, uncategorised and categorised counts and the share.

`sendBackTiers` (#1045, spec #1024), from `tools/harness/src/flow/send-back-tiers.ts`, reads the
judge's send-backs per writer tier. A send-back joins to the tier its pull request's writer joins
to (the same join as the cost above), and each tier gives its merged changes, its send-backs by
category (each category once per PR head, with `legacy` and `uncategorised` as in
`sendBackCategories` above), and its rework (#1009) with the merged changes it is read over. `rework` is always a
count; `reworkPerMergedChange` is null with no merged change, never zero. The `unlinked`
row holds the merged changes and send-backs that join to no tier, including a send-back with no
pull request number; it has no rework, since a send to a pane with no writer tier is not read. No
change is given a tier by inference. The text (`flow-lines-send-back.ts`) prints the same figures
the JSON carries.

`reviewRounds` (#1050, spec #1024), from `tools/harness/src/flow/review-rounds.ts`, reads the
failed review rounds and the review coverage per writer tier. A failed review round is a judge
send-back, or a principles-review verdict (a `review.run` event labelled `posted:<head>` or
`unchanged:<head>`, which `review post` and `review run` record) with `findings` of one or more, for
a head. Each PR head counts once, so a send-back and a failing verdict on the same head are one
round; a send-back that names no pull request or no head counts on its own, and a verdict whose
`findings` was never recorded is not a failed round. Failed review rounds are reported under that
name beside `rework` and are never rework: a failing verdict the writer fixes without a send is a
failed review round and not rework. `rework` is the same count `sendBackTiers` carries.
`reviewCoverage` is `reviewedChanges`, the merged changes with a principles-review verdict for
their head, over `mergedChanges`, and a change counts once however many verdicts it has. The ledger
records no merge head, so a merged change's head is the newest head a verdict or a send-back names
for it at or before its merge, and a verdict counts only for the head it names: a verdict on an
older head does not count for a later one. A change merged on a head that no verdict or send-back
names is read on the newest head one does name, which is a limit of what the ledger records. Every rate is null, never zero, with no merged change, and the counts it is read
over are beside it. A round and a change join to the tier of the pull request's linked writer; the
`unlinked` row holds those that join to none (it has no rework and no rate of failed rounds), and
no change is given a tier by inference. Only counts and rates are read: no verdict text, and no
label, is read into the figures. The text (`flow-lines-review-rounds.ts`) prints one
`Failed review rounds and review coverage` line per tier and one for the unlinked row, with the same
figures the JSON carries. Rounds are placed by the time each was recorded and merged changes by
their merge time, so the rate divides two counts from different events.

`violationsByRule` (#1051, spec #1024), from `tools/harness/src/flow/violation-rules.ts`, reads the
cited rule labels of failing principles-review verdicts per writer tier. A failing verdict is a
`review.run` event labelled `posted:<head>` or `unchanged:<head>` with `findings` of one or more,
recorded in the range; each PR head counts once and its latest such verdict stands. Each row has
`failedVerdicts`; `citations`, the rule labels those verdicts cite, a label counted once per
verdict; `rules`, each cited label with its `count` (the failing verdicts that cite it) and its
`share` (the count over the row's `citations`, to four places), most cited first and by label where
counts tie; and `unlabelled`, the failing verdicts that recorded no label. The labels are the
`rules` field `review post` records, short labels and never verdict text
(`tools/harness/src/ledger/schema-review.ts`); no comment text is read. A verdict joins to the tier
of its pull request's linked writer, and the `unlinked` row holds those that join to none, so no
verdict is given a tier by inference. The text (`flow-lines-violations.ts`) prints one
`Review violations by rule` line per tier and one for the unlinked row, each rule as
`<rule> <count> of <citations> (<share>%)`.

`breakEven` (#1051, spec #1024), from `tools/harness/src/flow/break-even.ts`, reads the rework
rounds per merged change at which Haiku's median all-in cost per merged change reaches Sonnet's. The
all-in dollars of a merged change are the ones `writerCost` reads (#1008), joined to a tier by the
first launch of its writer. The cost of one rework round is read from Haiku's own changes: the median
of those with exactly one rework send less the median of those with none (`noRework` and `oneRound`,
each with its `changes` and `median`). The break-even is Sonnet's median less the `noRework` median,
over that cost of one round (`costPerReworkRound`), as `reworkRoundsPerMergedChange`. Rework is the
#1009 definition, counted per pull request over the whole ledger
(`tools/harness/src/flow/change-rework.ts`); a send to a writer pane credits each of its writer's
pull requests that was sent back before it. The figure has four statuses: `ok`;
`insufficient merged changes`, with `needed` and each tier's `mergedChanges`, when a tier has fewer
merged changes than `cost.minMergedChanges` (or none), and no medians and no break-even;
`insufficient prices`, with the `models`; and `not read`, with a `reason` (no Haiku change without
rework, no Haiku change with one rework round, a rework round does not add to Haiku's median cost,
or Haiku's median without rework is above Sonnet's median) and the figures that were read. A
break-even is never negative: it is 0 when Sonnet's median equals Haiku's median without rework, and
it is `not read` when Sonnet's median is below it. The figure names no winner. The text
(`flow-lines-break-even.ts`) prints one `Haiku-Sonnet break-even` line after the review round and
violation lines, with Haiku's `rework` per merged change from `reviewRounds` beside it and the three
medians with their counts. The report moved to `version` 40 when the two joined it.

The split-at option (#1047, #1050, spec #1024) reads the `sendBackTiers`, `reviewRounds`, `violationsByRule` and `breakEven` figures a
second time, once over the time before TIME and once over the time from TIME on, so a reader
compares the changes before and after a fix. It adds four keys, `sendBackTiersSplit`,
`reviewRoundsSplit`, `violationsByRuleSplit` and `breakEvenSplit`, each with `at` (TIME as an ISO time), `before` and `after`, each side the same
shape as the figure it splits, and the text prints each side's tier lines under
`Send-backs by writer tier, before TIME:` and `Send-backs by writer tier, on or after TIME:`, and
under `Failed review rounds and review coverage by writer tier, before TIME:` and
`Failed review rounds and review coverage by writer tier, on or after TIME:`, and likewise under
`Review violations by rule by writer tier, before TIME:` and `on or after TIME:`, and
`Haiku-Sonnet break-even by writer tier, before TIME:` and `on or after TIME:`.
Merged changes are placed by their merge time, so a change merged exactly at TIME is on the after
side; send-backs, failed review rounds, rework and violations are placed by the time each was
recorded, as in the unsplit figures. TIME must lie inside the since and until bounds when they are given (equal to a
bound is allowed and leaves one side empty); the bounds still clip both sides, so a change merged
before the since bound is on neither. Without the split-at option the report has neither key and prints no such
lines. `version` moved to 39 when `reviewRounds` joined the report and to 40 when `violationsByRule` and
`breakEven` did; the split keys do not move it.
The cut itself is `splitSpanAt` and `splitFiguresAt` in `tools/harness/src/flow/date-split.ts`: a
figure that reads a span can be read on either side of a date by passing it to `splitFiguresAt`.

`reviewMisses` measures the Reviewer against the judge (#851). A review is a
`review.run` event that posted or left unchanged a verdict, counted once per PR
head by its first verdict; a review with `findings` 0 passed, and one with more
found a violation. `passedRuleBreak` counts the passed reviews whose PR a
`rule-break` send-back followed later (and not after the as-of time), and its `ratio`
is that count over every review in the range. `foundViolation` counts the
reviews that found at least one violation, as its `share` of every review. Each
has a `trailingAverage` over the 7 days before the range (or before the as-of time
when the range has no start), and `passedRuleBreak.worsened` is true when its
ratio is above that average. A review from before `findings` was recorded is
`unrecorded` and left out of every figure. A range or trailing span with no
review gives null, never zero, and the first window's null trailing average is a
baseline, not a comparison.

`review resample` re-reviews a sample of the passed reviews (#852). It draws
a sample (five by default, a placeholder; `harness review resample --help` names the option) from the passed reviews of merged PRs whose
head no re-review has taken yet, passed or failed, one Sonnet reader per head on
the override tier, which `session spawn` records with its reason. Each re-review
writes a `review.run` labelled `resample:<head>` with its `findings`, or
`resample-failed:<head>` when the reader ends blocked or with no verdict. It
posts nothing to GitHub, and `reviewMisses.resample` counts the re-reviews in the
range beside the ratio: `count` that read a verdict, `found` with at least one
violation, and its `share`, null when there are none. A re-review is never in
the reviews the ratio is taken over.

`finishDetection` counts the finishes the ledger holds (#853). The Stop hook
records a `session.result` carrying only the outcome word, when the turn's
assistant text printed a RESULT line. `session wait` records a `pane.finished`
with its pane, session name and outcome word the first time it sees that line.
A result is noticed when such a `pane.finished` falls on its pane within 300
seconds either side of it, and one finish detects one result. `undetected` counts
the results no finish detected, `detected` those that were, and `medianLagSeconds`
is the median seconds from a result to its finish among the detected: 0 when the
finish came first, null when none did. The 300-second threshold is a placeholder
until the owner sets it; the text report labels it so. The undetected results
split into `neverNoticed`, whose pane never had a `pane.finished` recorded, and
`late`, whose pane had one outside the window or used by an earlier result; the
two sum to `undetected`. A late result takes the nearest unused finish on its pane
at any distance, one finish to one result, so its lag is read; a late result with
no unused finish has no lag. `lagMinutes` gives `samples`, the `median` and the
nearest-rank `p90` in minutes over the detected and late results that have a lag,
each null with none. The lag is a reported reading of how late a finish was
recorded, not a merge delay. Results with no pane are not counted. A failed
`session notify` leaves no ledger event, so the report does not count those.

`qualifierWarnings` counts the qualifier's warnings (`qualifier.warned` events)
over the ideas filed in the range (`idea.filed` events), as `warnings`, `filed`
and `perFiled` (#866). It is a figure only: the qualifier warns and never
refuses.

`stalledPanes` counts stalled panes from two sources that do not read each
other (#854). `recorded` counts the `pane.stalled` events the herdr poll appends
when a session-spawned pane has been idle or gone for 300 seconds with no RESULT
printed since it last started work. The session hook starts `ledger poll-herdr`
in the background at each session start, beside `ledger poll-github` (#1091); the
poll reads herdr and writes ledger events only, and never closes, restarts or
messages a pane. `silentSessions` counts silent sessions: the last
`token.usage` is more than 900 seconds before the report's measuring point, with
no RESULT since. The text report prints `recorded` beside it. `backgroundExcluded` counts silent sessions left out because a
`tool.start` marked `background` is open on their pane: one that started after
the pane's last RESULT. A pane waiting on an open reserved question is exempt from
both counts (#854, ADR 0120): the `decision ask` that posted the question records
`decision.routed` with its pane and issue number, and the question stays open until
an untagged owner reply on that issue (`owner.replied`, from the GitHub poll) comes
after it. `questionExcluded` counts the silent sessions left out for it. Token usage
never exempts a pane, and the detector reads no token usage. The 300 and 900 second
thresholds are placeholders until the owner tunes them.

Known limits until plan 8 Step 3 lands its producers: nothing records
`issue.closed` or the `idea` link on PR events yet, so real ledgers show no
completed ideas and the report says "Not enough data". A label other than
`ready-for-agent` is counted as an unmapped event. A pane still waiting at its
last event is charged no time past it. Equal waiting ties go to the earlier
stage.

The JSON form is one object, `version` 13; any field change bumps `version`:

| Field               | Meaning                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | Shape version, `13`.                                                                                                                                           |
| `asOf`              | Time open waits are measured to.                                                                                                                               |
| `ideas`             | `{ total, completed }`; completed means the issue closed.                                                                                                      |
| `minCompletedIdeas` | Completed ideas needed before a bottleneck is named.                                                                                                           |
| `stages`            | Nine entries in loop order: `{ stage, activeSeconds, waitingSeconds, events, toil, wip }`.                                                                     |
| `leadTime`          | `{ ideas: [{ idea, seconds }], medianSeconds, maxSeconds }`, completed ideas only.                                                                             |
| `bottleneck`        | `{ stage, waitingSeconds, share }` (share 0 to 1), or `null`.                                                                                                  |
| `bottleneckNote`    | Always present: why `bottleneck` is `null` (too few completed ideas, or no waiting recorded), else `null`.                                                     |
| `unmappedEvents`    | Events with no stage or no idea, left out of every stage.                                                                                                      |
| `attribution`       | `{ since, events, withIdea, withIdeaAndStage, noRoleShare }`: how many role-session events the report can place, and the share of session events with no role. |
| `rework`            | Escalations, send-backs and friction per closed idea, see below.                                                                                               |
| `friction`          | `{ total, sources, unknownKinds }`, see below.                                                                                                                 |
| `guardBlocks`       | `[{ rule, blocks }]`, most blocked first, from `guard.block` events.                                                                                           |
| `guardBlocksByRule` | `{ [rule]: blocks }`, every known guard rule a key with zero where none, then any other rule the ledger names; the per-rule metric an idea names (#984).       |
| `outcomes`          | `{ mainRed, reverts, liveRuns, ownerMinutes }`, see below.                                                                                                     |
| `skippedLines`      | Ledger lines that were not valid events.                                                                                                                       |

### Rework and friction metrics

`rework` has `escalationsPerIdea`, `sendBacksPerIdea` and `frictionPerIdea`,
each counted per closed idea from `escalation`, `send-back` and friction
events. A ledger written before the challenger was retired may hold
`challenge.round` events; they still parse and count as unmapped events. Like the cost metrics, each
gives the latest closed idea (`currentIdea`, `current`), the `trailingAverage`
of the N ideas before it, `maxIncrease` (0.25) and `worsened`, or
`{"status": "insufficient history", "closedIdeas", "needed"}`, never zero.

`rework` also has `followUpsPerWriterSession` and `mainFollowUpsPerWriterSession`,
the orchestrator's follow-ups per writer session: a `session.send` to a pane
that a `session.launch` with role `writer` started in the same idea. The first
counts every sender, the second only the main session (a send with no
`senderRole`). Each is a per-idea metric in the same form, over the closed
ideas that had a writer session. `rework.followUps` is `{ writerSessions,
bySender }` for the range: the writer sessions launched, and the follow-ups per
sender (`main session`, or a `senderRole`), most first.

`friction` is `{ total, sources, unknownKinds }` for the range. A source is
`{ kind, source, events }`: a `hook rule` (the rule of a `guard.block` or
`guard.audit` event), a `command` (the `kore` command of a `kore.retry` event,
one per retry of a failed command) or a `pane` (the id of a `pane.interrupted`
event). Events of a kind the report does not know are left out and counted in
`unknownKinds`; an empty ledger gives zeros.

`kore.retry` carries the `kore` command as `label`; `pane.interrupted` carries
the `pane`; `escalation` is the one `harness queue escalate` records, with the
PR `number` and the model as `label`. `kore.retry` and `pane.interrupted` are
written only through `harness ledger record` (they are not poller kinds); the
report never writes the ledger, and `integration/flow-write-path.spec.ts`
checks that.

### Attribution and outcome metrics

A writer, judge or principles-review spawn with no idea prints a warning
and still starts, and records a `spawn.unstamped` event with its role and name.
A no-idea reason says why a session serves no idea (`harness session spawn --help` names the option): it records the reason
as the event's label, prints no warning, and is refused together with an idea.
A reader's spawn with no idea records nothing unless it gives a no-idea reason. The
flow report counts these spawns as `unstampedSpawns` (`total`, and `withReason`
for those given a reason). They are neither friction nor stage time.

`session spawn` with an idea stamps `KORE_IDEA=#N`, and always `KORE_AGENT=<name>`,
into the new pane's environment (`herdr pane split --env`). Every event a hook
records in that pane carries them as `idea` and `agent`, so the report maps the
pane's events to a stage by its role suffix and to its idea. The stamp is set
by the harness at spawn, not typed by the agent. A claude event with no agent
takes the name its pane was last given by a herdr event, so older ledgers map
too; a claude session still unnamed is the main session, `orchestrate`.
`attribution` counts the role-session events in range (cost events, GitHub
events and the repository-wide events below left out) that have an idea, and an
idea and a stage, from the moment sessions began carrying the stamp: `since` is
the first claude event that names its agent, and is `null` until there is one.
A role-session event is one whose session was stamped at launch or whose name
ends in a role; the main session has none. Events recorded before the stamp
cannot carry one, so they stay unattributed and are not counted against the
figure. `noRoleShare` is the share, 0 to 1, of the session events since the
stamp that come from sessions with no role, so it shows how much orchestration
still runs in the main session; it is `null` when no session event is in range.

A blocked tool call records a `guard.block` event whose `label` is the rule
name, never the command; `guardBlocks` counts them per rule, and
`guardBlocksByRule` keys the same counts by rule name with every known rule at
zero, so a rule can be a flow metric before it blocks anything. The event id holds
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

The judge's precheck and merge trust principles-review verdicts only from the
reviewer logins they name: `reviewerLogins` in `.claude/harness.json` when set,
else the owner login (`ownerLogin`, else the repository's owner). A verdict from
any other login is unverified. A GitHub App's login is written `app/<slug>`, such
as `app/kore-reviewer` for the Reviewer App; the owner names it in `reviewerLogins`
once the App posts (the owner's step). A reviewer login given to `harness judge precheck` (`harness judge precheck --help` names the option) overrides both, and
`harness judge precheck` prints the reviewers it used in its text and JSON output.

`harness review run <pr>` posts that verdict itself. It reads the PR head once,
spawns the principles-review Reviewer (Sonnet, medium, from its definition)
through `session spawn`, collects its `VERDICT:` block with `session wait`, and
posts it for that same head. If the head moved during the review it discards the
verdict and reviews again (3 reviews at most); a pane that ends blocked or with
no verdict records a `review.run` failure event and posts nothing. A posted or
unchanged verdict's event records its `findings` count, 0 for a clean review.
`orchestrate run` calls it before each precheck.

`harness harness wait` is the main session's one background wait (ADR 0123). Its help (`harness harness wait --help`) names the targets, each a pull request or a session, which may repeat; it checks each target once,
then returns on the first to settle: CI green or red for a pull request (as
`pr checks` reads it), or a RESULT line for a spawned session (recorded as
`session wait` records it). An idea can be waited on by name, repeatably, or any idea can be waited on; both give the ledger's idea states, and
the two idea waits do not combine. Settled exits 0 and names the target,
its kind and state (for an idea, the idea that moved), with the targets left to
restart with. Its JSON form gives the same as one object. The bound (the timeout, in
milliseconds, one hour by default) exits 3 and names what is still pending and
the next step, never just a timeout. The
`main-session-wait` flag, off in every overlay, adds one line to the main
session's SessionStart brief that names it, in place of sleep, until and seq
loops.

An idea's state is derived from the ledger, not recorded by the tick (#1033):
the tick prints each idea's step and writes nothing new for it. A state is set
by the last event of these kinds, and an event that sets the same state as the
idea is already in is not a change:

| Event                               | Keyed to                | State                                          |
| ----------------------------------- | ----------------------- | ---------------------------------------------- |
| `idea.filed`                        | its `idea`              | `filed`                                        |
| `issue.labelled`, `ready-for-agent` | `#<issue>`              | `approved`                                     |
| `issue.labelled`, `needs-info`      | `#<issue>`              | `needs-info`                                   |
| `decision.routed`                   | its `idea`              | `reserved`                                     |
| `pr.opened`                         | its `idea`              | `pr-open`                                      |
| `pr.linked`                         | the PR's idea           | `pr-open`                                      |
| `send-back`                         | the PR's idea           | `sent-back`                                    |
| `pr.merged`                         | its `idea`, or the PR's | `merged`                                       |
| `outcome`                           | its `idea`              | the outcome label, such as `outcome:confirmed` |

The PR's idea is the `idea` its `pr.opened` event names. `session.result` sets
no state: a session event names no idea. An idea is keyed as the ledger records
it, so idea `0007` and idea `#7` are different waits. The mapping is
`tools/harness/src/ledger/idea-state.ts`, the one place the rule is written.
`main-session-wait` flag, off in every overlay, adds one line to the main
session's SessionStart brief that names it, in place of sleep, until and seq
loops.

Every verdict that `review post` or `review run` posts starts with a sender line,
`sender: <role> <session> (<command>)`, or `sender: the main session (<command>)`
from the main session. The harness takes the role and session from the spawn
environment, so an agent cannot choose them. A comment with no sender line is the
owner's. Older verdicts with no line still count.

The same line starts every other comment or review the harness posts: `judge
send-back`, `judge approve` (the approval's review body), `guardrail request`,
`outcome record` and `outcome close`, `decision make`, `evaluate`, and the `pr open` body, which
keeps its `Safety pattern:` line last. The posting commands take no `--role`
flag, and a command refuses to post when the environment cannot name its sender.
The module also refuses a body with a line of guardrail approval syntax,
`approve <rule>:...`. That is validation of the harness's own posts, not
containment: a bare `gh` comment never passes through it.

`harness pr open` writes the `Idea:` line for the idea it is given (`harness pr open --help` names the option) and records the
same idea on the `pr.linked` event that links the pull request to its writer, as
the writer named it (ADR 0126). An idea of `none`, or no idea, writes no `Idea:`
line and records `none`, so a bug fix or a docs change needs no idea. The tool
renders the `Idea:` line, never the writer by hand.

`decision make` (`harness decision make --help` names its options) is the advisor's tool, given the idea or, for a plain ticket with no idea record, the issue ([ADR 0120](../decisions/0120-recommended-decisions-go-to-an-advisor-reserved-decisions-to-the-owner.md)).
It posts the decision on the idea's issue (or the plain ticket's issue) and records
`decision.made` with the idea (or the issue number) and the category only; the question and the reasoning stay on the issue. It
does nothing while the `decision-advisor` flag is off in the local overlay, and it
refuses, posting nothing, a question that matches the reserved list in
`tools/harness/src/decision/reserved.ts` or a category that names a reserved one.
The patterns there are a backstop for a fail-closed router, not the boundary, and
changing the list is itself a reserved decision.

`decision route` (`harness decision route --help` names its options)
is how a pane raises a question ([ADR 0120](../decisions/0120-recommended-decisions-go-to-an-advisor-reserved-decisions-to-the-owner.md)).
It answers `advisor` or `owner` and records `decision.routed` with the idea, the
category, the route and the signal; the question and the action stay out of the
ledger. The owner gets any question whose category is reserved, whose question or
action matches the reserved list or the guard's secret-path pattern, that names the
advisor's own files, whose category or question is unreadable, or that is escalated.
The advisor gets one only when the declared category and the matcher both agree. An
escalation writes `owner`, and no input moves an owner route to the
advisor. It is refused, with nothing recorded, while the `decision-advisor` flag is
off, and a pane that gets no route acts as if the question were the owner's.

`decision ask` (`harness decision ask --help` names its options) posts a
reserved question on the idea's issue, under the sender line, with the `needs-info`
label, and records `decision.routed` to the owner ([ADR 0120](../decisions/0120-recommended-decisions-go-to-an-advisor-reserved-decisions-to-the-owner.md)).
A question or action of more than a line is written to a file with the Write tool and
given by its `-file` flag; giving a flag and its file together is refused, naming both.
It refuses, with nothing posted, a question the advisor decides (use `decision make`),
and a consent prompt: an action that matches the destruction list stays inline with
its gate and is never routed. It is refused while the `decision-advisor` flag is off.

`decision digest` posts the owner digest, at most once a day, to the one issue pinned
on the repository: the open reserved questions, blocking first, and whether the tick
is not running. It records `decision.digest` with no question in it. It refuses while
no issue or several are pinned, and posts nothing when no question is open and the
tick runs. `harness status` lists the open questions after the idea counts. A tick
writes `decision.blocking` to mark an idea whose question blocks it; the tick does not
write that mark yet.

`harness queue next` lists the frontier behind the local `tick-ticket-queue` flag (off).
It holds every open `ready-for-agent` issue that no exclusion keeps out: an assignee, the
`paused` or `spec` label, an open blocker, a sub-issue (a parent), a grilling source
(a body that starts `Filed by `), or an idea issue whose idea record has an outcome or no
record. It orders the queue: pending send-backs first, then issues without the `harness`
label before those with it, `horizon:next` before `horizon:then` before neither, oldest
first, lowest number on a tie. The JSON form adds `excluded` with each reason, and the explain option
places one issue or names why it is out (`harness queue next --help`). `harness idea sync` adds the `harness`
label to a harness idea's issue when it creates or edits it, with the flag on, and never
removes one. The tick takes the items in that order; it starts a plain ticket only with the
`tick-ticket-queue` flag on (see `orchestrate tick`). A ticket labelled `live-proof` is not worked as a plain ticket: with the `tick-live-proofs` flag on too, the tick starts one `live-proof-<issue>` pane for the first such ticket, one at a time on the host. A held host lease or a running live-proof pane starts none and is reported as held (`live-run`, `live-proof`). The pane records a verification outcome and a comment, and never activates a flag.

`orchestrate tick`, scoped to an idea when given (`harness orchestrate tick --help` names the option) ([ADR 0121](../decisions/0121-the-orchestrator-is-a-tick-with-judgment-panes.md))
is one pass over the queue that advances each approved idea by at most one step,
then exits, and calls no model. It does nothing, and exits 0, while the
`orchestrator-tick` flag is off in the local overlay. It runs under a
per-machine lease, one file in the host lock directory, that a tick holds for its
pass and the next tick recovers once it is 30 minutes old. A pane it starts is
named for its idea and the PR head it works at (`idea-<idea>-judge-<head>`), so
a rerun finds the pane and starts nothing twice. With the flag on, `orchestrate
run`, given an idea (`harness orchestrate run --help`), runs ticks scoped to that idea until it ends, instead of its own
loop. The standing loop and the heartbeat are later steps. A third send-back starts
a judgment pane (ADR 0121) that decides once: its plan is checked whole, a refused
plan is retried once, then the idea is labelled `needs-info`. A later third send-back
is reported as `needs-judgment` and nothing is started for it.

A judgment's work plan is persisted once through `orchestrate plan` (`harness orchestrate plan --help` names the idea and issue options),
which reads the plan as JSON on stdin (`{"work": [...]}`), checks it with the same checker,
refuses a piece whose pane name `session spawn` would refuse, and writes it to
`.kore/state/tick-plans/<idea>.json` in the main checkout. It appends one `tick.plan` ledger
event with the piece count, so a rerun of the same plan writes and records nothing twice; a
different plan for an idea that already has one is refused for the owner. The ledger holds no
brief, which is why the plan's text lives in that file. It does nothing, and exits 1, while
`orchestrator-tick` is off. The tick then starts the plan's pieces one at a time, each after
the pieces it waits for, in a pane named `idea-<idea>-piece-<name>`: a writer in its own
worktree, or a reader. A piece that ends blocked stops the plan for the owner, and once every
piece has a closed pane the idea goes on to its pull request.

Before it starts a pane, the tick reads the host. On battery, or when the power
source cannot be read, one pane starts per pass (saver mode). It reads `pmset` on
macOS and `/sys/class/power_supply` on Linux, where a host with no battery (a server
or desktop) counts as on mains and a battery that is discharging counts as on battery. Above the load
ceiling `KORE_SPAWN_MAX_LOAD`, or while a live run holds the host lease, no pane
starts. Each start that a bound holds is reported as `held` with the bound's name,
and is recorded as a `tick.bound` ledger event on the idea's issue. The held idea
starts on the first pass the bound clears. A close, a send-back and an outcome
start no pane, so a bound never stops them.

When an idea reaches an end that needs a person, the tick sends the attended pane one
line, once per idea and state: `sender: tick orchestrator-tick (orchestrate tick): Idea <n>
needs a person: <reason>.`. The step ends are `blocked`, `needs-judgment` and `needs-info`, a
subset of the ends `orchestrate run` stops at: `awaiting-judge` is a judge pane's wait, not a
person. They and `reserved` (below) are the states of the constant `NEEDS_A_PERSON`. The attended pane is the pane the idea's latest session
was spawned from, read from the session registry. The line goes through the signed send path,
and the send is recorded as a `session.send` event naming the idea and the state, so a restart
or a later pass sends nothing twice. An idea with no recorded pane gets no line.

With the `tick-ticket-queue` flag on too (off in every overlay), a plain `ready-for-agent`
ticket in the queue takes the idea's steps: a writer pane named `idea-ticket-<issue>-writer`
whose brief is the issue number and title with an instruction to read the issue and follow
`writer.md`, `review run`, the precheck and send-back, the judge, and a relaunch on the tier's
model, each keyed on the ticket and the PR head so a rerun starts nothing twice, under the same
power, load and live-run bounds. A ticket labelled `live-proof` is skipped. A ticket records no
outcome after the judge merges (its `Refs` or `Closes` decides whether GitHub closes the issue),
and a third send-back reports `needs-judgment` with nothing started.

With the `tick-self-update` flag on too (off in every overlay), `orchestrate tick` in loop mode (`harness orchestrate tick --help`) runs a step before each pass: on a clean checkout of `main` that is behind `origin/main` as a fast-forward, it runs `git pull --ff-only` and then `mise run harness-build`, so a merged harness change runs on the host with no SSH. A dirty tree, another branch, a non-fast-forward, or a failed fetch or pull is reported and the old bundle keeps running. A failed build is recorded as a `tick.self-update-failed` event, and the step waits until `origin/main` moves. A pull that changes the loop's own files prints one line: restart the loop (`harness orchestrate tick --help`), since the running loop is not reloaded.

With the `behind-main-notice` flag on too (off in every overlay; detection runs only when both
flags are on), a pass checks each idea's open pull request. A PR that conflicts with main
(`DIRTY`), or is ready to merge but behind main (`BEHIND`, CI green, no judge precheck failure),
gets one branch update notice, the **Branch update notice** in the glossary: a `session send` to
the idea's live writer pane that says to merge origin/main, never rebase or force-push, and to reply
with exactly `pinned: no change` as its RESULT line when a live proof is pinned to its head. It is
recorded as a `session.send` event keyed by the PR head and main's head, so a restart sends nothing
twice and a changed main head sends again. A PR whose writer pane is not live is reported, not
messaged, since the tick closes a finished writer before it looks at the PR. The tick never pushes,
updates or merges a branch.

A reserved question (ADR 0120, #1058) is the fourth state, `reserved`, and it is read from the
ledger, never from the issue's labels. The tick checks it on every step of a queued idea: an
owner-routed `decision.routed` event on the idea that no `owner.replied` on its issue has
answered, and that no `reserved` `session.send` has come after, gets one such line on that pass.
The `needs-info` label is not read, since a judgment-flow stop writes no `decision.routed`.

Each checklist item of the precheck (`ci`, `scan`, `coverage`,
`principles-review`, `expand-step`, `pattern-match`, `guardrail-activation`) reads its mode from the
guardrail inventory, `.claude/guardrails.yaml`, as the rule `judge-<item>` of kind
`checklist`; every item is in `enforce` today except `guardrail-activation`, which starts in `audit`. A failing `enforce` item makes the
report not ready, so the change goes back. A failing `audit` item is listed in the
report (`audited` in the JSON form, an `audit:` line in the text) and never makes it
not ready; each audit firing writes one `guard.audit` ledger event labelled with
the rule, once per item and head. An unreadable inventory or a mode other than
`audit` or `enforce` is refused with the fix named. Moving an item to `enforce`
needs a person's approval (ADR 0080).

`harness judge merge` re-runs the same precheck, so these items are the merge
tool's gates and read the same modes. A failing `enforce` gate blocks the merge;
a failing `audit` gate never does: the merge goes ahead, lists the gate (an
`audit:` line, or `audited` in the JSON form) and the precheck's ledger write records
its one `guard.audit` event. An unreadable inventory or an unknown mode refuses
the merge before anything is read or merged.

`harness judge precheck` also refuses to run when its harness bundle is behind
`origin/main` for `tools/harness`: the build stamps the bundle with its commit,
and the precheck asks GitHub's compare API whether main changed a file under
`tools/harness` since. It names the fix (update the worktree, `mise run
harness-build`). When GitHub cannot compare (no stamp, an unpushed commit, no
network) it only warns.

The `pr-declaration` workflow audits every PR body with `harness judge
declaration` (the body on stdin): exactly one valid `Safety pattern:` line, and
it is the last line. It is an audit; a failure annotates the run and does not
turn the check red. Making it required is a ruleset change for the owner.

A contract step (`expand-contract`, a diff that removes lines) passes once its
expand step is proven (ADR 0107). The PR body names the merged expand PR on
`Expand step: #<number>`, and the idea issue carries a comment from a trusted
reviewer login with a line `Expand proof: #<number>` for that PR. The expand
PR must merge before the contract's head commit. Without all three, the
precheck refuses and says what to add.

A listing too long to page through (200 runs or PRs, or 300 comments, events or
commits) fails the poll instead of recording part of it: pass a since time to bound
a first poll. Later polls start a day before the latest recorded signal, and
the since time can only reach back past that, never later, so it cannot step over a
failed run.
Each rate is `null`, never zero, when nothing was measured, and each counts only
events inside the since and until bounds. Only counts, conclusions and times are
stored, never a title, body or login.

## Retro due and record

`harness retro due` says whether a retro is due, from
recorded data only, and writes nothing. It is due with reason `count` once five
distinct ideas have an `outcome` event after the `Last retrospective:` marker
(the latest across `infra/plans`, the one the session brief reads), or early
with reason `metric`, naming a trailing flow metric (`tokensPerIdea`,
`sessionsPerIdea` or a `rework` metric) that `worsened` on an idea closed after
the marker. A metric with `insufficient history` never triggers. A reason
already recorded after the marker does not fire again: the answer is not due
with `alreadyTriggered`. Its JSON form (`harness retro due --help`) is one object: `due`, `reason`, `metric`,
`closedIdeas`, `threshold`, `alreadyTriggered`, `lastRetrospective`. It exits 0
whether or not a retro is due, and never starts one; running `/retro` stays a
separate step.

`harness retro record`, given its reason (`count`, `manual` or `metric:<name>`; `harness retro record --help` names the option), appends one
`retro-triggered` event (the reason as `label`) and moves the marker. The marker
is the `Last retrospective:` line of the `## Retrospective marker` section the
command keeps at the end of `infra/plans/3-agent-harness.md`; the event and the
marker carry the same UTC second, so the new window opens exactly there. A
malformed reason is refused with nothing written; a reason already recorded in
the window is not appended twice, but the marker still moves. Never edit the
section or the ledger by hand. Nothing triggers `retro record` automatically
yet (plan 12, Step 2 follow-ups).

## Approve a harness idea

`harness approve`, given the idea's number or slug (`harness approve --help` names its options), applies the
`ready-for-agent` label to a harness idea (`kind: harness`, a metric, direction
and window) only when both hold. The change is reversible: safety pattern
`no-behaviour-change`, `feature-flagged`, `dark-launched` or
`branch-by-abstraction` (`expand-contract` migrates data, so it is not), and the
idea's title, summary and expected outcome do not move a guardrail to enforce.
And its metric is in the flow report with a trailing average and enough history
(`status: ok`; a metric with `insufficient history`, one with no trailing
average, or an unknown one is refused). Otherwise it leaves the idea for a
person and says why.

The reason is posted as a comment on the idea's issue (it opens with an HTML
marker, `<!-- harness:auto-approved -->` or `<!-- harness:left-for-person -->`)
and an `auto-approved` event (the metric as `label`, the issue as `number`) is
recorded in the ledger. Each write happens once: a rerun posts, labels and
records nothing twice, and finishes a half-done run. A label already on the
issue is a person's and gets no event. Its JSON form (`harness approve --help`) is one object: `idea`, `issue`,
`status` (`approved`, `already-approved`, `left-for-person` or `flag-off`),
`reason` and `warnings`.

The qualifier also warns, and never refuses (#866, ADR 0119). It warns when the
idea's primary metric is a guard metric (`GUARD_METRICS` in
`tools/harness/src/flow/metric-names.ts`: tokens, send-backs, friction, owner
minutes and lead time), or when another harness idea with no outcome yet names
the same primary. Each warning is printed, listed in `warnings`, and recorded
once as a `qualifier.warned` event (the warning as `label`, the issue as
`number`). A warning leaves the status as it was. The flow report's
`qualifierWarnings` gives `warnings` over `filed` (the `idea.filed` events in
the range) as `perFiled`, null while no idea was filed. Note that `idea new`
does not write `idea.filed` yet, so `filed` counts only the ideas retro filing
records until that is wired.

An agent's label never counts as the owner's approval: the poller skips the
marked comments and the label the harness applied when it records
`owner.action`, so owner minutes stay the owner's own.

Nothing runs `approve` unprompted: it is a command only, with no scheduler or
trigger. The `automatic-approval` flag is off in every overlay. With it off the
command writes nothing (no comment, label or event) and only reports the
verdict as `flag-off`. Turning the flag on is the owner's step, after a
recorded outcome.

## Model-tier ideas

A harness idea that edits `model` or `effort` in an agent definition's
frontmatter is a model-tier idea. It declares both what it saves and what the
saving must not cost, using the flow report's own metric names:

```text
kind: harness
hypothesis-metric: metrics.tokensPerIdea
hypothesis-direction: down
hypothesis-window: 14d
tier-change: model, effort
guard-metric: rework.sendBacksPerIdea
```

`harness idea new` takes a tier change and a guard metric beside the `kind: harness` fields (`harness idea new --help` names both options).
`kb-check` refuses a tier idea that declares only cost (no `guard-metric`), a
cost metric other than tokens per idea falling, a guard other than judge
send-backs, and a `tier-change` field beyond `model` or `effort`.

`harness approve` classes a tier idea as reversible only when the declared
change is a frontmatter edit of `model` or `effort` and send-backs have a
trailing average to compare against; a change touching anything else is left
for a person. Nothing changes by itself: approve and revert stay behind their
flags.

`harness evaluate` judges both metrics over the same windows. Tokens per idea
falling by at least the threshold while send-backs do not rise past it (or from
none) is `confirmed`. Cost falling while send-backs rise past the threshold, or
rise from none, is `refuted`, and the existing revert prepares the PR when its
flag is on. Cost that did not fall keeps its own result; no send-backs figure
before or after makes it `inconclusive`. The JSON form adds `guard`
(`metric`, `before`, `after`). A rerun leaves a recorded outcome as it is.

## Guardrail approval requests

`harness guardrail request` (`harness guardrail request --help` names its options) asks a
person to approve changing one guardrail's mode. Run `harness hook retro-scan` first, in strict mode (`harness hook retro-scan --help`), and keep its JSON; the request reads only counts from it: how
often the rule fired, heeded, overridden, and the false positives you state
(the false-positives count is the retro's count of warnings or blocks that hit
legitimate work). An audit rule needs its `rules.audit` row, and its
classification (`promotable`, `insufficient-evidence`, `not-promotable`) is the
scan's own, from one shared function. An enforced rule is measured by its
`guards` blocks. Tightening (audit to enforce), loosening (enforce to audit) and
removal are requested the same way.

The scan's report also has an `agents` section (the agents with a definition,
those launched in the window, and those never launched) and a `proposals`
section: the window and minimums it used (14 days of ledger or 100 sessions, each set under `retro` in `.claude/harness.json`) and a
ready command for each finding, an `idea new` for an unused skill or agent and a
prefilled `guardrail request` for a promotable audit rule. Below either minimum
it reports insufficient history and proposes no removal. The scan runs none of
the commands, and `guardrail activate` still needs a person's approval.

It posts one comment on the idea's issue, with the idea link and the figures
(never transcript text), and appends a `guardrail.requested` ledger event whose
label is `<rule>:<from>><to>`. It posts once per change: a rerun finds the event,
or the comment's marker, and posts nothing. With no evidence for the rule, no
issue on the idea, an unknown rule or a mode the rule already has, it refuses
with the fix and posts nothing. A request never changes `.claude/guardrails.yaml`;
`guardrail activate` is the separate step below.

`harness guardrail status`, in its JSON form (`harness guardrail status --help`), adds `pending`: `{ rule, from, to, idea }` for
each latest request whose rule still has the mode it would change. The person's main session
answers "what is waiting for approval?" from it.

## Guardrail activation

`harness guardrail activate` (`harness guardrail activate --help` names its options) is the only way a guardrail's mode changes or an entry
leaves `.claude/guardrails.yaml`. It acts after `guardrail request`, and only on a
person's approval: a comment on the idea's issue from the owner login
(`ownerLogin` in `.claude/harness.json`, else the repository's owner), made after
the request comment, with the line `approve <rule>:<from>><to>`. A label never
counts, however it was applied, and neither does a comment that carries a
harness marker (`<!--`) or comes from another login. Enforcing, loosening and
removing need the same approval.

An approving comment whose first line is a sender line (`sender: ...`) was
posted by a session, not the owner. It still approves, so the gate is unchanged,
but the activation warns: the result carries a `warning` naming the comment, the
warning goes to stderr, and a `guardrail.approval-warned` ledger event is
recorded for the change before anything is written. Refusing such a comment is
the owner's decision, not this command's. When the owner's own untagged
approval is also on the issue, that approval counts and no warning is given.

With the approval it edits the rule's line (or drops it), regenerates the
settings deny list for a deny rule, and appends a `guardrail.activated` ledger
event labelled `<rule>:<from>><to>`. A ruleset rule still needs `ruleset sync` to
reach GitHub. Without a recorded request, an approval or with only a label, it
exits 1, leaves the file untouched, and posts one refusal comment on the idea's
issue (a rerun with the same refusal posts nothing). The JSON form prints
`{ rule, from, to, idea, issue, activated, reason?, refusalPosted?, commentUrl?, warning? }`.

Two checks hold the line elsewhere. The guard blocks an Edit or Write of the
inventory that sets a rule to enforce, or adds one already in enforce
(`guardrail-demotion`, which also covers demotion and deny removal); it does
not see `guardrail activate`, which writes the file itself. The judge's
`judge-guardrail-activation` item reads the inventory at the merge base and at
the PR head, and sends the change back when it lands a rule in enforce,
loosens or removes one with no matching `guardrail.activated` event; a new rule
must start in audit. That item starts in audit mode, so today it is reported
under `audited`, and a person turns it on with the same request and activate
steps.

## Guard replay

`harness guardrail replay` (`harness guardrail replay --help` names its options) lists the recorded Bash, Read, Write and
Edit calls in the window that the rule refused under the old git ref and the new
ref's guard allows, as JSON. Each ref is checked out in a detached worktree in a
worktrees folder under `.claude`, its harness is built there, and each call is sent to that
build's `hook guard` as the PreToolUse payload it would have been; the worktrees
are removed when the replay ends, even after a failure. The payload names no
session, so the guard writes no ledger event, and the replay never reads the
ledger or writes the inventory. The calls come from the session transcripts of
this repository and its worktrees, the same ones the retro scan reads. An empty
`changed` list is stated as empty (`"empty": true`). It is a developer tool, not a
guard (ADR 0101).

An idea that changes what a guard blocks is confirmed on this checklist (ADR 0119):

1. The guard corpus still blocks every known-bad case in CI (`CORPUS` in
   `tools/harness/src/hook/guard-corpus.ts`).
2. Run `guardrail replay` over the idea's window, with the guard's refs before and
   after the change.
3. A reader pane checks the `changed` list, and the judge reads its report.
4. One changed command that left the worktree or wrote outside its role refutes
   the idea, whatever the block count says.
5. The revert restores the approved state with no approval, and the escaping
   command joins `CORPUS` in the reverting change. The revert and the escape go in
   the next owner digest.

## Status

`node skills/bin/harness.mjs status` is the one read-only status call for the
person's main session. It never writes; its JSON form (`harness status --help`) prints `{ plans, ideas, ledger }`: `plans`
is the `plan active` list with open items per step; `ideas` is
`{ byState, items }`, where a state is `open` until an outcome closes the idea
as `success` or `failure`; `ledger` is `{ recent, skipped }`, the ten latest
stage events (`{ occurredAt, stage, kind, number?, idea? }`) newest first.
No bounded role may run it.

## Prompt size

`node skills/bin/harness.mjs session prompt-size [<session-id>]` prints a
session's latest request prompt (input plus cache writes plus cache reads) against the
`compactionCap` in `.claude/harness.json`. It is read-only and never writes. With no
name it reads the newest transcript of this checkout's own Claude project directory and
prints that session's id. With a Claude session id it reads that session only when its
transcript is in this repository's own transcript directories (the main checkout and
its worktrees); any other session is refused. A name must be a plain id, letters,
digits, `-` and `_`.

The text line is `session <id>: prompt <n>, cap <n>, over` or `..., cap <n>, not over`;
a prompt equal to the cap is not over. With no cap set it prints `cap not set` and exits
0, never under the cap. Its JSON form (`harness session prompt-size --help`) prints `{"session","prompt","cap","over"}`, with `cap` and
`over` null when no cap is set. A malformed config, a missing transcript, and a transcript
with no request yet each exit 1 with the reason, never a size of zero. The command is in
the hook domain (`hook/prompt-size-command.ts`) and the host composes it into the session
table (`cli/host.ts`), so the session barrel does not import it.

## Rules that bite

- External processes run only through the injected runner; mutations name their
  environment and context.
- Secrets never touch disk or git in plaintext.
- Every command change updates the usage text and the README in the same change.
- New policies start in audit mode; versions are pinned exactly.
- Documents must be in [`docs/index.md`](../index.md) (ADRs, plans, and skills
  are required there; `mise run kb-check` checks).
