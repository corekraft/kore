---
status: done
summary: Make the plans, ADRs, and skills reachable by agents through an index, frontmatter, upward links, and a health check.
last-verified: 2026-11-07
---

# Knowledge Base Plan

## Purpose

Agents are the main readers of this repository's documents. Their main failure
is unreached context: an agent finds files that look complete but never reaches
the one that explains why. The reasons behind most decisions sit inside long,
finished plans (`1-initialize.md` alone is over 800 lines), and nothing points
an agent to the part that matters. This plan makes that context reachable and
keeps it current with a script, not with prose.

## Principles

- Plain Markdown and grep. The corpus is small; an index and summaries are
  enough. No embeddings, search services, or runtime dependencies.
- Judgment in notes, mechanics in scripts. Documents explain; `kb-check.mjs`
  verifies links, the index, and frontmatter.
- Link from the specific to the broader picture: code to its plan step or ADR,
  plan steps to the ADRs they rely on.
- Point, don't copy. A document that repeats what another file owns links to it
  instead.
- The check starts in warn mode and is promoted once the tree is clean.

## Formats

Every session working on this plan uses these formats exactly.

### Frontmatter

Plans and ADRs start with flat, JSON-compatible YAML frontmatter (scalar
strings only, no lists or nesting):

```yaml
---
status: done
summary: One sentence saying what this document decides or delivers.
last-verified: 2026-11-07
---
```

- Plans: `status` is `active` or `done`.
- ADRs: `status` is `proposed`, `accepted`, or `superseded`, plus a `date:`
  key. A superseded ADR adds `superseded-by:` with the replacing ADR's path from
  the repository root. Frontmatter replaces the old `- Status:` and `- Date:`
  bullets.
- `last-verified` is the date someone last confirmed the content matches the
  repository.

### Index

`docs/index.md` lists every plan, ADR, skill (`skills/*/SKILL.md`), and key
reference file, grouped under `##` headings. Each entry is one line:

```markdown
- [`path/from/root`](../path/from/root) — what it decides. Read when …
```

### Upward links in code

A source file links to the document that explains it with a comment line near
the top:

```ts
// Docs: infra/plans/2-implementation.md#step-9-workload-identity-application-image-trust-and-policy
```

The path is from the repository root. The optional `#anchor` is the GitHub
slug of a heading in that file. `Plan:` and `ADR:` are accepted as the same
marker, so existing headers such as `// Plan: infra/plans/3-agent-harness.md`
count.

## Step 1: Extract Decisions into ADRs

### Work

- [x] Read `infra/plans/1-initialize.md` and `infra/plans/2-implementation.md`
      and list the significant decisions recorded only inside them (tool
      choices, ownership boundaries, trust model, topology, refinements of an
      earlier decision).
- [x] Write one ADR per decision with the `write-adr` format and the frontmatter
      above, numbered from `0002`. Each ADR cites the plan section it came from;
      `status: accepted` for decisions already implemented.
- [x] Replace the decision prose in the plans with a one-line link to the ADR
      where the prose only restates it; keep step work and exit criteria.
- [x] Convert `0001-kore-typescript-cli.md` to frontmatter.
- [x] Update `skills/write-adr/SKILL.md` to the frontmatter format.

### Exit Criteria

- [x] Every ADR has valid frontmatter and a link back to its source section.
- [x] No decision is restated in both a plan and an ADR.

## Step 2: Index and Frontmatter

### Work

- [x] Add frontmatter to every plan in `infra/plans/`.
- [x] Write `docs/index.md` covering every plan, ADR, skill, and key reference
      file (`infra/catalog/compatibility.md`, `infra/catalog/versions.yaml`,
      `infra/catalog/components.yaml`, the schemas, `.claude/evals/`).
- [x] Point to the index from `AGENTS.md` and `README.md`.

### Exit Criteria

- [x] `kb-check` reports no missing or stale index entries.

## Step 3: Knowledge Health Check

### Work

- [x] Write `.claude/hooks/kb-check.mjs` with tests beside it, Node standard
      library only. It reports, with file and line and a fix for each:
  - relative Markdown links in tracked `.md` files that don't resolve,
    including `#anchor` slugs;
  - index entries whose file is missing, and plans, ADRs, or skills missing from
    the index;
  - plans and ADRs with missing or invalid frontmatter;
  - `Docs:`/`Plan:`/`ADR:` comment lines whose path or anchor doesn't resolve;
  - top-level `kore` commands in the CLI usage text that `README.md` doesn't
    mention.
- [x] Run it in warn mode from `mise run test-hooks` (exit 0, findings printed)
      with a `--strict` flag that exits non-zero; add `mise run kb-check`.

### Exit Criteria

- [x] Tests cover each finding type, and that a clean tree reports nothing.
- [x] `mise run kb-check -- --strict` passes on the tree after Steps 1, 2, and 4.

## Step 4: Upward Context

### Work

- [x] The session brief in `.claude/hooks/context.mjs` lists the titles of the
      next three steps with open items after the current one, so an agent
      designs for what comes next.
- [x] The brief and compaction context cover every plan whose frontmatter says
      `status: active`, not only the highest-numbered one, so this plan doesn't
      hide `2-implementation.md`. Plans without frontmatter keep the
      open-item rule.
- [x] Add a `Docs:` header to each domain entry point under `tools/kore/src/*/`
      (its `index.ts`, or the main module where there is none) pointing at the
      plan step or ADR that governs it.

### Exit Criteria

- [x] A brief test shows upcoming step titles and none after the last step.
- [x] Every domain under `tools/kore/src/` has a resolving `Docs:` header.

## Out of Scope

- Semantic or hybrid search, embeddings, and decision models.
- Bridges to Notion or Drive, and MDX.
- Inbox and event daemons; a scheduled run of `retro` and `kb-check` is a
  possible follow-up once the check is strict.
