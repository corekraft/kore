---
status: accepted
summary: Refines ADR 0080 and plan 12 Step 2: the automatic retro pane ends with its proposals as JSON in a fixed schema, and orchestrate run files them as harness ideas behind the automatic-retro flag, checking the whole batch first, capping one retro at 5 ideas, keying each on the trigger id plus a content hash, and leaving approval to the qualifier.
date: 2026-11-15
last-verified: 2026-11-15
---

# ADR 0118: Retro proposals are filed as ideas by a tool

Source: [`infra/plans/12-self-improving-loop.md` § Step 2](../../infra/plans/12-self-improving-loop.md#step-2-automatic-retro)

Refines: [ADR 0080](0080-guardrails-change-freely-activate-with-approval.md) and [ADR 0117](0117-the-delivery-loop-s-role-set.md).

## Context

The automatic retro pane is briefed to propose only. ADR 0117 removes the
roles that could run `idea new`, so after it no spawned role can turn a retro
finding into a harness idea, and auto-approval would have nothing to approve.
The pane's output is model text, so a tool that acts on it must treat it as
untrusted input.

## Decision

- **The pane proposes in a fixed form.** The retro pane runs on Sonnet at high
  effort and ends with one JSON array between a `PROPOSALS-JSON` line and an
  `END-PROPOSALS-JSON` line, one object per idea with the `idea new` fields:
  `title`, `hypothesis`, `expectedOutcome`, `measurement`, `safetyPattern`,
  `metric`, `direction` and `window`. It still changes no file. Its launch
  records the tier as an override of the reader definition, with the reason.
- **`orchestrate run` files them.** After it collects the pane with
  `session wait`, and only while the `automatic-retro` flag is on, it files the
  proposals through the idea domain (`idea new`). With the flag off nothing is
  filed.
- **The batch is checked whole.** Every item must be an object with exactly the
  eight string fields, each short and not starting like YAML syntax, a metric
  the flow report has, a recognised safety pattern, a direction of up or down
  and a window in days. One bad item refuses the whole batch with the item and
  field named, and nothing is filed.
- **A cap of 5 per retro.** The first 5 are filed. The rest are dropped and
  recorded in one `retro.dropped` event per trigger, which the flow report
  counts as `retroProposalsDropped`, so a cap set too low shows.
- **Filing is idempotent.** Each idea's slug is the retro's trigger id plus a
  short content hash. `idea new` returns an existing slug untouched, so a rerun
  after a crash files nothing new and records no second event.
- **Approval stays with the qualifier.** Filing never labels or approves an
  idea. Auto-approval goes only through the qualifier (ADR 0117), and a
  guardrail still goes through a guardrail request and a person.
- **The ledger gains two additive kinds.** `idea.filed` (the idea and its key)
  maps to the refine stage in the flow report, and `retro.dropped` carries the
  dropped count.
- **A flag guards it.** The change is feature-flagged behind `automatic-retro`
  (off). Turning it on needs its recorded live outcome and an owner activation
  (ADR 0077).

## Consequences

- A retro that prints malformed or no proposals files nothing, and the run
  reports why on stderr without failing.
- Retro ideas cost one Sonnet pane; if ideas from Sonnet retros are refuted at
  a clearly higher rate, the tier returns to a larger model (ADR 0117).
- The cap of 5 is a placeholder, re-checked with the other placeholders after
  about two weeks of ledger.
