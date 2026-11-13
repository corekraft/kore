---
status: accepted
summary: Harness ideas, guardrail changes included, are approved automatically when reversible and measurable, but a changed guardrail lands in audit mode and enforcing it needs a person's approval.
date: 2026-11-11
last-verified: 2026-11-12
---

# ADR 0080: Guardrails change automatically and activate with approval

Source: [`infra/plans/12-self-improving-loop.md` § Step 4](../../infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate)

Refines: "Audit before enforce" in [`AGENTS.md`](../../AGENTS.md#platform).

## Context

The self-improving loop turns retrospective findings into harness ideas and
keeps or reverts them on their outcome. Requiring a person to approve every
harness idea would make the person the bottleneck. Letting the loop change and
enforce its own guardrails unchecked would let it weaken its own safety.

## Decision

A harness idea is approved automatically when the change is reversible and its
outcome is measurable from the ledger. It is reverted automatically when its
outcome refutes it. This covers agent definitions, skills, tools, model tiers,
and guardrails.

A guardrail is any harness rule that blocks or gates an unsafe action: guard
hooks, deny rules, the judge's checklist, the merge tool, and the `main`
ruleset. A changed guardrail lands in audit mode. Turning it to enforce needs
a person's approval, presented with the idea and its outcome summarized.

## Consequences

The loop can make itself cheaper and faster without waiting on a person, and
it can propose stricter or looser guardrails with evidence. No guardrail
changes what it blocks until a person agrees. Guard code needs an audit mode
for each rule it enforces.

## Addendum (2026-11-12): false positives are a person's judgement

The activation request shows counts, not a verdict. For a rule in audit mode it
shows how often the rule fired and what followed each firing: the agent
heeded it, a person overrode it, the agent repeated the identical call, or
nothing followed. Those four add up to the firings. Whether a firing hit
legitimate work (a false positive) cannot be read from a transcript, so the
request asks the approving person to judge it and never reports a count of
false positives. A rule with no measure (an enforced deny rule, an enforced
ruleset rule) gets no request until it has one; the request never shows figures
that nothing measured.
