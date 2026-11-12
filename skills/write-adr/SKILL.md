---
name: write-adr
description: Use when choosing between two designs, changing what a plan in infra/plans or a decision in docs/decisions says, or when a plan step refines an earlier decision.
---

# Write an ADR

Write one when a choice between designs, or a change to a plan or an earlier
decision, would otherwise be lost. Skip it for routine work the plan already
says.

1. **Create it:** `node skills/bin/harness.mjs adr new --title <t> --summary <one sentence> --status <proposed|accepted> --source <plan path>#<heading-slug> [--refines "ADR NNNN"] [--json]`.
   It picks the number, writes the frontmatter and body skeleton, and adds the
   `docs/index.md` entry. `accepted` means already implemented or agreed.
2. **Fill in** Context, Decision and Consequences. Say why the decision changed
   when it refines an earlier one. State the decision and its consequences, not
   the implementation. Keep it short.
3. **Replace an ADR:** `node skills/bin/harness.mjs adr supersede --old <N> --new <M> [--dry-run] [--json]`.
   It marks the old one `superseded` and links the replacement.
4. **Point, don't copy.** In the plan, replace prose that only restates the
   decision with a one-line link to the ADR. Keep work items, exit criteria and
   headings.

Format details and refusals: [reference.md](reference.md).
