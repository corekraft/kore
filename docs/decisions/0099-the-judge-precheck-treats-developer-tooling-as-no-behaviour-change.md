---
status: accepted
summary: A diff of docs, tests and developer tooling matches no-behaviour-change; the boundary fails closed, and a guard rule that starts enforcing declares no-behaviour-change, gated by ADR 0080.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0099: The judge precheck treats developer tooling as no behaviour change

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md); the gate for guard rules comes from [ADR 0080](0080-guardrails-change-freely-activate-with-approval.md).

## Context

The precheck compared a `no-behaviour-change` declaration with the paths of the
diff and called every path that was not a doc or a spec behavioural. A change
to the harness, a hook, a skill, a test helper or a workflow is developer
tooling: no user of `kore` and no cluster observes it. Such a change could
never declare a pattern truthfully, and the judge could not pass it.

## Decision

For `no-behaviour-change`, the precheck leaves developer tooling out of the
behavioural paths and lists it as `toolingPaths`. The hint stays; the judge
still reads the diff. Only this mismatch rule changes. No other check moves.

Tooling is:

- `tools/harness/`, `.claude/`, `skills/`, `tools/kore/tests/`,
  `tools/kore/.husky`, `tools/kore/scripts`, the kore config files
  (`tools/kore/*.config.*`), and the `check.yml` and `nightly.yml` workflows.
- Test support inside `tools/kore/src`, by name: `*.fixtures.ts`,
  `*-fixtures.ts`, `*-support.ts` and the `src/testing/` domain. A production
  file with such a name slips past; the judge reads the diff.
- `tools/kore/package.json` and its lockfile when the diff changes only
  scripts or devDependencies (in the lockfile, only dev-only packages).
  A change to runtime `dependencies`, a removal, or a change the precheck cannot
  place in a section is product.

Everything else is product, including `release.yaml`, `apps`, `infra`,
`catalog`, charts and kore production code. The boundary fails closed.

A guard rule that starts enforcing changes what a session can run, but nothing
a user or a cluster observes. Its gate is [ADR 0080](0080-guardrails-change-freely-activate-with-approval.md),
audit first or a person's recorded approval to enforce, not a delivery safety
pattern. Such a change declares `no-behaviour-change`.

## Consequences

- Tooling changes pass the precheck with the pattern they truthfully declare.
- A mixed diff of tooling and product still names the product paths.
- A product file named like test support is not caught by the precheck; the
  judge's reading of the diff is the backstop.
- Cluster-facing detection is unchanged, so a live run is still required for
  those diffs.
