---
status: accepted
summary: A diff of docs, tests and developer tooling matches no-behaviour-change; the boundary fails closed, and a guard rule that starts enforcing declares no-behaviour-change, gated by ADR 0080.
date: 2026-11-12
last-verified: 2026-11-14
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

This refines the first version of the list, because every conversion ticket
under [ADR 0098](0098-unit-tests-mock-everything-outside-the-unit-and-integration-tests-gate-only-a-release.md)
and [plan 14](../../infra/plans/14-test-tiers.md) edits a list: each domain's
`unconverted.txt` loses a line, and a scripts-only change to
`tools/kore/package.json` was reported behavioural. A hunk shows three lines of
context, so its `"scripts"` header is often out of view, and the precheck could
not place the change.

The integration tier of [ADR 0098](0098-unit-tests-mock-everything-outside-the-unit-and-integration-tests-gate-only-a-release.md)
adds a read-only merge-check workflow, `.github/workflows/integration.yml`, and
its setup, `tools/kore/integration-setup.ts`. Both only build and run tests, so
no user or cluster observes them, but the list named neither, and the precheck
reported such a PR as behavioural. The owner decided on 2026-11-14 to add
exactly these two paths. `tools/kore/tsconfig.json` stays product: a compiler
setting can change what runs. `.mise.toml` was product here too; [ADR 0101](0101-the-judge-precheck-treats-mise-toml-as-developer-tooling.md)
refines that and makes it tooling.

## Decision

For `no-behaviour-change`, the precheck leaves developer tooling out of the
behavioural paths and lists it as `toolingPaths`. The hint stays; the judge
still reads the diff. The mismatch rule changes, and so do two things that follow
from renames, below. No other check moves.

Tooling is:

- `tools/harness/`, `.claude/`, `skills/`, `tools/kore/tests/`,
  `tools/kore/.husky`, `tools/kore/scripts`, the kore config files
  (`tools/kore/*.config.*`), the `check.yml`, `nightly.yml` and
  `integration.yml` workflows, and `tools/kore/integration-setup.ts`, the setup
  of the integration tier.
- `.mise.toml` at the repository root, the task wiring and tool pins of the
  repository ([ADR 0101](0101-the-judge-precheck-treats-mise-toml-as-developer-tooling.md)).
- Test support inside `tools/kore/src`, by name: `*.fixtures.ts`,
  `*-fixtures.ts`, `*-support.ts` and the `src/testing/` domain. A production
  file with such a name slips past; the judge reads the diff.
- Any `unconverted.txt` (`**/unconverted.txt`), the list of a domain's sources
  not yet converted to unit tests.
- The `.gitignore` change that adds the `test-results/` line and nothing else.
  Removing a line, or adding any other, is product.
- `tools/kore/package.json` when the diff changes only scripts or
  devDependencies. The precheck reads the whole manifest at the PR's merge base
  and at its head, and compares both without those two sections; a hunk is not
  read, because its context can hide the section header. A change to runtime
  `dependencies`, a package moved between sections, a change to any other key,
  a manifest that does not parse, or a side the precheck did not fetch is
  product. A diff of the manifest with no hunks (a mode change, a binary diff)
  is product.
- The lockfile, when the diff changes only dev-only packages (the root lockfile
  entry's devDependencies included). A change the precheck cannot place under a
  header in view of its own hunk is product, and so is a lockfile key that is
  not a package entry.
- A renamed file is tooling only when both its old and its new path are. A
  doc or spec counts as quiet only when both sides of a rename are, and the
  precheck lists a rename as `old -> new` so a message says what moved from
  where.

Everything else is product, including `release.yaml`, `apps`, `infra`,
`catalog`, charts and kore production code. The boundary fails closed.

A guard rule that starts enforcing changes what a session can run, but nothing
a user or a cluster observes. Its gate is [ADR 0080](0080-guardrails-change-freely-activate-with-approval.md),
audit first or a person's recorded approval to enforce, not a delivery safety
pattern. Such a change declares `no-behaviour-change`.

## Consequences

- Tooling changes pass the precheck with the pattern they truthfully declare.
- A mixed diff of tooling and product still names the product paths.
- A diff that touches `tools/kore/package.json` costs the precheck three more
  `gh api` reads (the merge base and the manifest at both commits), and the
  precheck fails closed when one of them fails.
- A product file named like test support is not caught by the precheck; the
  judge's reading of the diff is the backstop.
- Cluster-facing detection also looks at the old path of a rename, for every
  pattern: a file moved out of `apps`, `infra`, `catalog` or a chart is still
  cluster-facing, so a live run is still required for those diffs.
