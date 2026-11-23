---
status: active
summary: Let the delivery loop improve its own harness from measured outcomes, with automatic retro, auto-approved and auto-reverted harness ideas, and guardrails that need approval to enforce.
last-verified: 2026-11-12
---

# Self-Improving Loop Plan

## Purpose

The delivery loop should get cheaper and faster on its own evidence, without a
person remembering to run a retrospective. This plan closes that loop on top of
the plan 8 ledger and the plan 11 idea records, while keeping the loop unable to
weaken its own guardrails
([ADR 0080](../../docs/decisions/0080-guardrails-change-freely-activate-with-approval.md)).

## Step 1: Harness Metrics

### Work

- [x] Extend the ledger and flow report with tokens and sessions per idea,
      writer escalations, judge send-backs and friction
      events (failed or retried `kore` commands, hook blocks, interrupted
      panes).
- [x] Let the concierge answer how the loop is doing from the report.

### Exit Criteria

- Each metric has a trailing average and is visible in `flow report --json`.

> **Baseline shift (2026-11-15).** From the change for
> [#745](https://github.com/corekraft/kore/issues/745), `orchestrate run` runs
> the precheck before any judge pane and sends a failing change back itself,
> recorded as the judge `send-back` event, once per PR head. So judge
> send-backs per idea (`rework.sendBacksPerIdea`) include precheck failures from
> 2026-11-15; ledger events before that date are judge send-backs only. Compare
> windows that straddle the date with that in mind.
>
> **Category shift (#810).** From the change for
> [#810](https://github.com/corekraft/kore/issues/810), every send-back carries
> one reason category: a judge send-back names one with `--category`, and a
> precheck send-back gets the category of its failure. Before that change a
> send-back has no category and the flow report counts it as uncategorised, so
> counts by category do not compare across the change: a category can look as if
> it rose only because older events have none. `rework.sendBacksPerIdea` counts
> the same events before and after, because the category is an added field on
> the same event. Read a window that straddles the change by its total, not by
> category.

## Step 2: Automatic Retro

Next: First run the #225 closed-loop live proof, then #325 notify live proof. Then record an outcome for each of automatic-retro ([#715](https://github.com/corekraft/kore/pull/715)), automatic-approval ([#718](https://github.com/corekraft/kore/pull/718)) and automatic-revert ([#720](https://github.com/corekraft/kore/pull/720)), and only then run harness flag activate for each (owner's call). Merged: Step 1 metrics ([#708](https://github.com/corekraft/kore/pull/708), [#711](https://github.com/corekraft/kore/pull/711)); retro due, Opus retro pane, harness ideas ([#712](https://github.com/corekraft/kore/pull/712), [#716](https://github.com/corekraft/kore/pull/716)); evaluate and tier measurement ([#719](https://github.com/corekraft/kore/pull/719), [#722](https://github.com/corekraft/kore/pull/722)); judge and merge gate audit mode ([#713](https://github.com/corekraft/kore/pull/713), [#714](https://github.com/corekraft/kore/pull/714)); guardrail request and activate ([#717](https://github.com/corekraft/kore/pull/717), [#721](https://github.com/corekraft/kore/pull/721)). Step 4's land-in-audit box stays open until the owner decides whether #721's mechanism (a new rule must start in audit; judge-guardrail-activation is still in audit) satisfies it; enforcing that rule later goes through guardrail request and guardrail activate with a person's approval. Full state: #366.

> **Deferred (2026-11-12).** Steps 2 and 3 wait until the Step 1 metrics are
> fixed and about 20 ideas have outcomes recorded by something other than the
> delivering agent. Automating retro and approval on metrics the delivering
> agent can influence would tune the loop on noise.

### Work

- [ ] `orchestrate tick --idea <n> --loop` starts retro on Sonnet at high effort after every five
      closed ideas, or as soon as a metric worsens past its threshold against
      its trailing average. The retro pane proposes, and `orchestrate tick --idea <n> --loop` files
      the proposals as ideas ([ADR 0117](../../docs/decisions/0117-the-delivery-loop-s-role-set.md)).
- [x] Retro findings become harness ideas, each with a hypothesis tied to a
      metric.

### Exit Criteria

- No person needs to start a retro.

## Step 3: Auto-Approve and Auto-Revert

> **Deferred (2026-11-12).** Same condition as Step 2.

> **Attribution (2026-11-16).** An auto-revert is only as good as the metric
> it reads. Each harness idea names a primary metric that only it moves, read
> from events the changed code does not write; metrics several ideas move are
> guard metrics that must not worsen, and no outcome is read until idea attribution
> holds ([ADR 0119](../../docs/decisions/0119-each-harness-idea-is-measured-on-a-primary-metric-only-it-moves.md)).

### Work

- [ ] Approve a harness idea automatically when its change is reversible and
      its outcome is measurable from the ledger.
- [ ] Revert it automatically when its outcome refutes it.
- [ ] Tune model tiers through the same path, by changing agent frontmatter.

### Exit Criteria

- A refuted harness change is reverted with no person involved, and the revert
  is in the ledger.

## Step 4: Guardrail Activation Gate

### Work

- [x] Give every guardrail an audit mode: guard hooks, deny rules, the judge's
      checklist, the merge tool and the `main` ruleset. (Done for the `main`
      ruleset: `main` stays active and an audit rule syncs into a `main-candidate`
      ruleset in `evaluate`, ADR 0090; deny rules, ADR 0080 and #299.)
- [ ] Land changed guardrails in audit mode.
- [x] Ask a person to approve enforcing each one, presenting the idea and its
      outcome summarized.

### Exit Criteria

- No guardrail changes what it blocks without a person's approval on record.

## Results

Not started.
