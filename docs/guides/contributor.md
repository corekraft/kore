# Contributor Guide

How to change this repository. The rules are in [`AGENTS.md`](../../AGENTS.md);
this page is the short path through them.

## Set up

```sh
mise install
mise exec -- npm --prefix tools/kore install
```

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
   mise run kb-check -- --strict
   mise run scan
   ```

   Format by hand with `mise run format <files>`, never a bare `npx prettier`.

4. **Commit** with a Conventional Commit, lowercase imperative subject
   (`feat(ci): guard release signer permissions`). Hooks run typecheck, lint,
   format, and unit tests; `--no-verify` is blocked.

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
  `test:integration:registry`). A change to what runs in a cluster needs a live
  run before merge.
- Upstream chart and container checks are opt-in too (`test:upstream-charts`,
  `test:container-smoke`).

## Flow report

`node skills/bin/harness.mjs flow report [--json]` reads the stage ledger
(`.kore/state/ledger.jsonl`, shared by every worktree) and reports, per stage of
the delivery loop, active seconds, waiting seconds (waiting on a person counts),
event count and toil, then names the bottleneck: the stage with the largest share of
all waiting. Flags: `--min-ideas N` (default 3), `--as-of TIME`, `--ledger PATH`.

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
next `tool.start` of the same tool). Toil overlaps active and waiting time; it
is a breakdown, not an addition. Each life of a reused pane counts on its own.

Known limits until plan 8 Step 3 lands its producers: nothing records
`issue.closed` or the `idea` link on PR events yet, so real ledgers show no
completed ideas and the report says "Not enough data". A label other than
`ready-for-agent` is counted as an unmapped event. A pane still waiting at its
last event is charged no time past it. Equal waiting ties go to the earlier
stage.

`--json` prints one object, `version` 2; any field change bumps `version`:

| Field               | Meaning                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `version`           | Shape version, `2`.                                                                                        |
| `asOf`              | Time open waits are measured to.                                                                           |
| `ideas`             | `{ total, completed }`; completed means the issue closed.                                                  |
| `minCompletedIdeas` | Completed ideas needed before a bottleneck is named.                                                       |
| `stages`            | Nine entries in loop order: `{ stage, activeSeconds, waitingSeconds, events, toil }`.                      |
| `bottleneck`        | `{ stage, waitingSeconds, share }` (share 0 to 1), or `null`.                                              |
| `bottleneckNote`    | Always present: why `bottleneck` is `null` (too few completed ideas, or no waiting recorded), else `null`. |
| `unmappedEvents`    | Events with no stage or no idea, left out of every stage.                                                  |
| `skippedLines`      | Ledger lines that were not valid events.                                                                   |

## Rules that bite

- External processes run only through the injected runner; mutations name their
  environment and context.
- Secrets never touch disk or git in plaintext.
- Every command change updates the usage text and the README in the same change.
- New policies start in audit mode; versions are pinned exactly.
- Documents must be in [`docs/index.md`](../index.md) (ADRs, plans, and skills
  are required there; `mise run kb-check` checks).
