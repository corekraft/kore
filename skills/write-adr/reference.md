# write-adr reference

Read when a `harness adr` call refuses or the file needs a hand edit.

## Frontmatter

Flat, JSON-compatible YAML, scalar strings only:

```yaml
---
status: accepted
summary: One sentence saying what this ADR decides.
date: 2026-11-07
last-verified: 2026-11-07
---
```

`status` is `proposed`, `accepted` or `superseded`. A superseded ADR also has
`superseded-by:` with the replacing ADR's path from the repository root. There
are no `Status` or `Date` bullets.

## Body

Title `# ADR NNNN: <decision>`, a `Source:` line linking the plan section (with
its `#anchor`), an optional `Refines:` line, then Context, Decision,
Consequences. `docs/decisions/0001-kore-typescript-cli.md` is the model.

## What the tools check

- `adr new` numbers from the highest ADR on disk, requires an existing
  `--source` plan and heading slug, rejects `--status superseded`, and writes
  nothing on refusal.
- `adr supersede` refuses a missing old or replacement ADR, an old ADR that is
  already superseded, a superseded replacement, and an ADR superseding itself.
  It changes only the old ADR's `status:` line and adds its `superseded-by:`
  line; `--json` lists exactly those lines. The index is untouched.
