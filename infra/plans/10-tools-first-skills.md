---
status: active
summary: Move the deterministic steps of skills and hooks into the harness package, so each skill is a short description plus tool calls.
last-verified: 2026-11-11
---

# Tools-First Skills Plan

## Purpose

Skills ask the model to do deterministic work by hand. That costs tokens,
invites mistakes, and keeps cheap models from running the loop. This plan
moves that work into the harness package
([ADR 0082](../../docs/decisions/0082-harness-package-bundled-for-skills.md)).
Each step reports its effect against the plan 8 baseline.

## Principles

- **A skill is a description and tool calls.** Description at most 200
  characters, body at most 25 lines, detail in reference files read on demand.
- **Behaviour first.** Each port pins current behaviour with tests before
  moving it.

## Step 1: write-adr Tool

### Work

- [x] Add an `adr` domain: `new` picks the next number, writes the file name
      and frontmatter, and adds the index entry; `supersede` updates the old
      ADR.
- [x] Shrink `skills/write-adr/SKILL.md` to judgement plus tool calls.

### Exit Criteria

- A new ADR passes kb-check without hand edits to numbering, frontmatter or
  the index.

## Step 2: spawn-session Tool

### Work

- [ ] Add a `session` domain that launches
      `claude --agent <role> --model <model> --effort <effort>` in a Herdr
      pane: split direction, pane naming, busy retry, worktree creation, and
      the anchored `RESULT` wait.
- [ ] Shrink `skills/spawn-session/SKILL.md` from 46 lines to the budget.

### Exit Criteria

- One tool call spawns a pane, waits for its result and returns it as JSON.

## Step 3: handoff Tool

### Work

- [ ] Add a `plan` domain that finds the active plan, ticks items, recounts the
      open-item lists and sets the single `Next:` line.
- [ ] Shrink `skills/handoff/SKILL.md`.

### Exit Criteria

- A handoff changes only the lines the tool reports.

## Step 4: Port the Hooks

### Work

- [ ] Port `guard`, `context`, `delta`, `feedback`, `kb-check`, `retro-scan`,
      `skill-links` and `workflow-permissions` into harness domains, pinning
      each with its existing tests first.
- [ ] Point `.claude/settings.json` at `node skills/bin/harness.mjs hook
    <name>`.
- [ ] Remove `.claude/hooks/*.mjs` once each is ported.

### Exit Criteria

- `.claude/hooks/` holds no logic, and every hook test runs under vitest.

## Step 5: Remaining Skills and Enforcement

### Work

- [ ] Bring `add-command`, `add-policy`, `pin-upgrade`, `retro` and
      `test-driven-development` within the budget, adding tools where a step
      is deterministic.
- [ ] Turn the skill budget audit from warn to fail.

### Exit Criteria

- `node skills/bin/harness.mjs skill audit` passes for every skill, and CI
  fails a skill over budget.

## Results

Not started.
