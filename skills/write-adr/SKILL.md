---
name: write-adr
description: Use when choosing between two designs, changing what a plan in infra/plans or a decision in docs/decisions says, or when a plan step refines an earlier decision.
---

# Write an ADR

Write one when a choice between designs, or a change to a plan or an earlier
decision, would otherwise be lost. Skip it for routine work the plan already
says.

1. **Create it:** `node skills/bin/harness.mjs adr new`, with a title, a one-sentence summary, a status (`proposed` or `accepted`), the plan heading it came from and, when it refines one, the ADR it refines (`harness adr new --help` names each option).
   It picks the number, writes the frontmatter and body skeleton, and adds the
   `docs/index.md` entry. `accepted` means already implemented or agreed.
2. **Fill in** Context, Decision and Consequences. Say why the decision changed
   when it refines an earlier one. State the decision and its consequences, not
   the implementation. Keep it short.
3. **Replace an ADR:** `node skills/bin/harness.mjs adr supersede` with the old and the new number (`harness adr supersede --help` names its options, including a dry run).
   It marks the old one `superseded` and links the replacement.
4. **Point, don't copy.** In the plan, replace prose that only restates the
   decision with a one-line link to the ADR. Keep work items, exit criteria and
   headings.

Format details and refusals: [reference.md](reference.md).
