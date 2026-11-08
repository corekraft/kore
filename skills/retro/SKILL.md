---
name: retro
description: Use to review recent sessions in this repository and propose changes to hooks, skills, AGENTS.md, or memory. Run manually after a few working sessions.
context: fork
agent: Explore
---

# Retrospective

Propose changes only. Never edit hooks, settings, skills, `AGENTS.md`, or memory yourself; a human accepts or rejects each proposal.

## Procedure

1. **Run the scan first:** `node .claude/hooks/retro-scan.mjs`. It covers the sessions since `Last retrospective:` in `infra/plans/3-agent-harness.md` and prints JSON counts: guard blocks and warnings per rule, failed tools, skills loaded, repeated corrections, `skills.unused`, and `rules.audit`.
2. **Turn each finding into a proposal**, smallest change first:
   - `rules.promotable` entry: promote that audit rule to enforce mode. `insufficient-evidence` or `not-promotable`: leave it.
   - `skills.unused` entry: archive the skill, or rewrite its description so it fires.
   - a `corrections` entry: a hook or deny rule if a script can check it, a skill if it is a workflow, `AGENTS.md` if it is judgment, memory if it is a personal fact.
   - a block or repeated failure that hit legitimate work: a false positive in the guard.
3. **Quote evidence only for those findings.** Open a transcript just at the `session` and `line` the scan names. Never read the rest, and never paste transcript content back.
4. **Rank** by how often it occurred, keep the list short, and end with it, each item with a short quote. The calling thread asks the user which to accept, records them in `infra/plans/3-agent-harness.md` or an ADR, and sets `Last retrospective:` to today; this read-only run cannot.
