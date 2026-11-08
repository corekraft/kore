---
name: write-adr
description: Use when choosing between two designs, changing what a plan in infra/plans or a decision in docs/decisions says, or when a plan step refines an earlier decision.
---

# Write an ADR

## Checklist

1. **Number it.** List `docs/decisions/` and take the next four-digit number.
2. **Name it.** File name `NNNN-short-kebab-title.md`.
3. **Start with frontmatter.** Flat, JSON-compatible YAML, scalar strings only:

   ```yaml
   ---
   status: accepted
   summary: One sentence saying what this ADR decides.
   date: 2026-11-07
   last-verified: 2026-11-07
   ---
   ```

   `status` is `proposed`, `accepted` (already implemented or agreed), or `superseded`. A superseded ADR adds `superseded-by:` with the replacing ADR's path from the repository root. Don't add `Status` or `Date` bullets.

4. **Copy the body** of `docs/decisions/0001-kore-typescript-cli.md`: title `# ADR NNNN: <decision>`, a `Source:` line linking the plan section it came from (with its `#anchor`), then Context, Decision, Consequences.
5. **Link what it refines.** Add a `Refines:` line naming the earlier ADR or plan step it changes, and say why in Context. When it replaces an ADR, set that ADR to `superseded` with `superseded-by:`.
6. **Point, don't copy.** In the plan, replace prose that only restates the decision with a one-line link to the ADR. Keep work items, exit criteria, and headings.
7. **Index it.** Add a one-line entry to `docs/index.md`.
8. **Keep it short.** State the decision and its consequences, not the implementation.
