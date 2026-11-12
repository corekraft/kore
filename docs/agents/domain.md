# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase. The layout is single-context.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/decisions/`**: read ADRs that touch the area you're about to work in.
  `docs/index.md` lists them.
- **`infra/plans/`**: the active plan records why each step exists. Read it
  alongside the ADRs.

If any of these files don't exist, **proceed silently**. Don't flag their
absence; don't suggest creating them upfront. The `/domain-modeling` skill
(reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates
`GLOSSARY.md` lazily when terms actually get resolved.

## File structure

```
/
├── GLOSSARY.md
├── docs/
│   ├── index.md
│   └── decisions/
│       ├── 0001-kore-typescript-cli.md
│       └── 0002-tool-responsibility-boundaries.md
├── infra/plans/
└── tools/kore/src/
```

## Recording decisions

ADRs live in `docs/decisions/`, never `docs/adr/`. Create a new one through the
repo's `write-adr` skill. It owns the format and numbering and adds the ADR to
`docs/index.md`. Don't use the plugin's ADR format.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`.
Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either
you're inventing language the project doesn't use (reconsider) or there's a
real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
