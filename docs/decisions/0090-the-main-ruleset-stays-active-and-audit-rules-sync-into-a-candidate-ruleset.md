---
status: accepted
summary: Main stays active permanently; a ruleset rule in audit mode syncs into a separate main-candidate ruleset in evaluate, promotion moves approved rules into main as active after a dry run and --confirm, and sync stops without changes when GitHub refuses evaluate on the plan.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0090: The main ruleset stays active and audit rules sync into a candidate ruleset

Source: [`infra/plans/12-self-improving-loop.md`](../../infra/plans/12-self-improving-loop.md)

Refines: [ADR 0080](0080-guardrails-change-freely-activate-with-approval.md) (a changed guardrail lands in audit mode; for the `main` ruleset, audit is a separate candidate ruleset, not a flipped `main`).

## Context

ADR 0080 says a changed guardrail lands in audit mode, and the `main` ruleset is
one. GitHub has a native audit mode: a ruleset's `evaluate` enforcement records
what it would have blocked and blocks nothing. Flipping `main` itself to
`evaluate` would drop every protection it holds today (the required `check` and
`scan`, squash-only, no deletion, no force push) for the whole audit period,
and a ruleset has one enforcement for all its rules, so it cannot audit one new
rule while enforcing the rest.

## Decision

- **`main` stays `active` permanently.** No sync sends `evaluate` to it.
- **Each declared rule has an inventory mode.** `.github/rulesets/main.json`
  declares every rule. `.claude/guardrails.yaml` has one `ruleset`-kind entry per
  rule, `main-ruleset-<rule>`. An `enforce` rule belongs in `main`; an `audit`
  rule syncs into a separate `main-candidate` ruleset in `evaluate`, so GitHub's
  rule-suite insights show what it would block.
- **Promotion moves a rule.** A person approves flipping the rule to `enforce`;
  `harness ruleset sync` then writes the rule into `main` as `active` and out of
  the candidate, after a `--dry-run` and the operator's `--confirm`. The candidate
  is written first, so a refusal leaves `main` untouched.
- **A live ruleset is never weakened silently.** The dry run, the refusal and the
  JSON name the rule types a sync adds to or removes from `main`. Removing one
  (including demoting a rule to `audit`) needs `--allow-removal`. A sync that
  changes the live ruleset needs `--confirm`, which stands for the operator's
  agreement; the guard warns on `--confirm` and on edits to the declared files.
- **If GitHub refuses `evaluate`** (HTTP 422, for example "requires GitHub
  Enterprise"), sync stops, says evaluate is unavailable on this plan, and
  changes nothing. Audit rules then wait; they are never enforced by default.
- **One sync at a time per repository.** A mutating sync takes a lock file under
  `.kore/state/locks/` around planning and saving. A dry run takes none.

## Consequences

- A new or changed ruleset rule can be observed against real pushes and pull
  requests before it blocks anyone, and `main` is never less protected than
  today while that happens.
- The repository holds two rulesets after the first audit rule. The candidate
  is only ever `evaluate`, so it cannot block.
- `harness ruleset insights` reads the candidate's firings for the activation
  request.
- Whether the plan allows `evaluate` is learned only by a live sync; nothing
  here applies one. Applying a change is the operator's decision.
