---
name: write-adr
description: Use when recording a significant architectural decision, or when a plan step refines an earlier decision.
---

# Write an ADR

## Checklist

1. **Number it.** List `docs/decisions/` and take the next four-digit number.
2. **Name it.** File name `NNNN-short-kebab-title.md`.
3. **Copy the format** of `docs/decisions/0001-kore-typescript-cli.md`: title `ADR NNNN: <decision>`, `Status` and `Date` lines, then Context, Decision, Consequences.
4. **Link what it refines.** Name the earlier ADR or plan step it changes (for example `infra/plans/2-implementation.md`) and say why.
5. **Keep it short.** State the decision and its consequences, not the implementation.
