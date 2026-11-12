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
- **A new or changed rule is observed before it blocks.** Sync keeps `main`'s live
  version of every rule until the candidate has held the declared one. An `audit`
  rule waits in the candidate. An `enforce` rule that is new to `main`, or whose
  parameters differ from `main`'s (a third required check, say), is staged in the
  candidate too and reported as pending; `main` keeps its old parameters. With no
  live `main` at all, `main` starts from the `enforce` rules.
- **Promotion moves a rule.** On the sync after the candidate holds the declared
  rule and its mode is `enforce`, sync writes it into `main` as `active` and out of
  the candidate, after a `--dry-run` and the operator's `--confirm`. A tightened
  rule held in the candidate can be promoted on the next `sync --confirm` with no
  insights window in between; that is acceptable because it only tightens. The candidate
  is written first, so a refusal leaves `main` untouched. Demoting a rule to
  `audit` leaves its live version in `main`; removing it from `main` means removing
  it from the declared file.
- **A live ruleset is never weakened silently.** One definition of "weaker" is
  shared by the guard hook and sync (`ruleset/weaken.ts`): a rule dropped, a
  required check dropped, a number lowered, a boolean or string changed, a merge
  method added, a bypass actor added, conditions changed, or a parameter missing
  from the file. The dry run, the refusal and the JSON name each one, and sync sends
  nothing, not even to the candidate, without `--allow-removal`. A sync that changes
  anything live needs `--confirm`, which stands for the operator's agreement; the
  guard warns on `--confirm` and on edits to the declared files. Any change to a
  top-level field other than `rules`, `name` and `enforcement` (`target`, for
  one: `branch` to `tag` would stop `main` protecting branches) counts too.
- **If GitHub refuses `evaluate`** (HTTP 422, for example "requires GitHub
  Enterprise"), sync stops, says evaluate is unavailable on this plan, and
  changes nothing. Audit rules then wait; they are never enforced by default.
- **One sync at a time per repository.** A mutating sync takes a lock file under
  `.kore/state/locks/` around planning and saving. A dry run takes none.

## Consequences

- A new, tightened or loosened ruleset rule can be observed against real pushes
  and pull requests before it blocks anyone, and `main` is never less protected than
  today while that happens.
- The repository holds two rulesets after the first audit rule. The candidate
  is only ever `evaluate`, so it cannot block.
- `harness ruleset insights` reads the candidate's firings for the activation
  request.
- Whether the plan allows `evaluate` is learned only by a live sync; nothing
  here applies one. Applying a change is the operator's decision.
