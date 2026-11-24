---
status: accepted
summary: Refines ADR 0109: merge is deployment; the merge tool merges a head the principles review permits once required checks are green and the head is unchanged, with no judge pane or owner prompt.
date: 2026-11-23
last-verified: 2026-11-23
---

# ADR 0183: A deterministic merge tool merges on the principles review verdict

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0109](0109-the-judge-approves-a-pull-request-through-its-own-tool-before-it-merges.md)

## Context

Merging to `main` is deployment. ADR 0109 has the judge pane approve and then
run `judge merge` after the precheck. The precheck is already deterministic;
the judge pane adds a second model judgment after the principles review, and
the factory's principles review already judges the whole feature at the exact
head against the safety patterns.

## Decision

- **The principles review decides.** It judges the encompassing feature at the
  exact head: a flag preserving the off path, dark code with no live caller,
  branch by abstraction, an isolated parallel run, a compatible expand or
  contract step, or a bounded strangler fig. It rejects an unprotected
  transition even with green CI, and answers "not applicable, safe to deploy"
  for a change with no runtime behaviour.
- **The merge tool merges.** When the verdict permits, every required check is
  green, and the head is the one reviewed, the merge tool approves under the
  `kore-judge` App identity (ADR 0122) and squash-merges with the head as its
  precondition (`--match-head-commit`). There is no judge pane, second model,
  owner prompt or activation step in between.
- **A flag guards it.** Behind `factory-merge` (off). Until it is on, ADR 0109
  holds.

## Consequences

- The judge pane leaves the merge path. `judge approve` and `judge merge` run
  from the tool, which still refuses a moved head and an author approving
  their own PR.
- The principles review's job widens from the AGENTS.md rules to the whole
  feature's safety pattern; its live definition keeps `review post`.
- Lab cases: `.claude/factory/principles-review/expectations.md`.

## How this was decided

By the owner in the factory adoption session of 2026-11-23, after the herdr lab
passed every case for the factory roles in three consecutive runs.
