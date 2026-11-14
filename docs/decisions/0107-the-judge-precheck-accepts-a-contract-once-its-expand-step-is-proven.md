---
status: accepted
summary: A contract step that removes lines passes the precheck only when it names a merged expand PR that merged before its head, and a recognised reviewer has recorded the expand's proof on the idea issue.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0107: The judge precheck accepts a contract once its expand step is proven

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: ADR 0099

## Context

ADR 0099 and the rules that followed it made the precheck judge a diff against
its declared pattern. For `expand-contract`, only an additive diff passed. A
contract step removes lines, so no contract could pass, even when its expand
step had shipped and been proven. The owner decided on 2026-11-14, on PR #584,
that the contract may pass once its expand step is proven, and that the expand
step itself keeps the additive rule.

## Decision

A contract step passes the precheck only when all three hold:

- The PR body names the expand PR on one `Expand step: #<number>` line. Without
  that line, or with two, the declaration fails. The line applies only to
  `expand-contract`.
- The expand PR is merged, and it merged before the contract's head commit. A
  contract that predates the expand's merge fails, and must get a commit after it.
- The Idea line names an issue, and a recognised reviewer login (the same trust
  list as principles-review) has posted a comment with a line
  `Expand proof: #<number>` naming that same expand PR. The number binds the proof
  to one expand, so it cannot be reused for another.

Otherwise the refusal stays, and names the fix. An expand PR that removes lines
still fails: the rule is unchanged for every PR that does not name an expand step.
The precheck reads these facts only through gh, and only when the diff fails its
pattern and the PR names an expand step.

## Consequences

- An expand-contract removal can merge once the expand step is proven on the
  record, with no change to the judge's merge tool.
- The proof is a comment by a person (or a reviewer login), not a flag an agent
  can set; `Expand proof:` is not a safety pattern and does not enable anything.
- A proof that names the wrong expand PR, or comes from an unknown login, does
  not count, and the refusal says why.
- Compatibility of the two steps is still listed as unverified: the judge reads
  the diff, and the proof records the expand's outcome, not the contract's
  correctness.
