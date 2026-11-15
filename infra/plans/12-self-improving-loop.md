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
      writer escalations, judge send-backs, Challenger rounds, and friction
      events (failed or retried `kore` commands, hook blocks, interrupted
      panes).
- [x] Let the concierge answer how the loop is doing from the report.

### Exit Criteria

- Each metric has a trailing average and is visible in `flow report --json`.

## Step 2: Automatic Retro

Next: Merged: Step 1 metrics ([#708](https://github.com/corekraft/kore/pull/708), [#711](https://github.com/corekraft/kore/pull/711)); retro due and record, Opus retro pane, harness ideas ([#712](https://github.com/corekraft/kore/pull/712), [#715](https://github.com/corekraft/kore/pull/715), [#716](https://github.com/corekraft/kore/pull/716)); approve, evaluate, revert, tier measurement ([#718](https://github.com/corekraft/kore/pull/718) to [#720](https://github.com/corekraft/kore/pull/720), [#722](https://github.com/corekraft/kore/pull/722)); judge audit mode, merge gate audit, guardrail request and activate ([#713](https://github.com/corekraft/kore/pull/713), [#714](https://github.com/corekraft/kore/pull/714), [#717](https://github.com/corekraft/kore/pull/717), [#721](https://github.com/corekraft/kore/pull/721)). Owed: #225 closed-loop live proof; #325 notify live proof; flag activations by the owner after a recorded outcome (automatic-retro, automatic-approval, automatic-revert); promoting judge-guardrail-activation through guardrail request and guardrail activate with a person's approval, which also closes Step 4's land-in-audit item. Full state: #366.

> **Deferred (2026-11-12).** Steps 2 and 3 wait until the Step 1 metrics are
> fixed and about 20 ideas have outcomes recorded by something other than the
> delivering agent. Automating retro and approval on metrics the delivering
> agent can influence would tune the loop on noise.

### Work

- [ ] The orchestrator starts retro on Opus after every five closed ideas, or
      as soon as a metric worsens past its threshold against its trailing
      average.
- [x] Retro findings become harness ideas, each with a hypothesis tied to a
      metric.

### Exit Criteria

- No person needs to start a retro.

## Step 3: Auto-Approve and Auto-Revert

> **Deferred (2026-11-12).** Same condition as Step 2.

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
