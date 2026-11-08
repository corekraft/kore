---
name: retro
description: Use to review recent sessions in this repository and propose changes to hooks, skills, AGENTS.md, or memory. Run manually after a few working sessions.
---

# Retrospective

Propose changes only. Never edit hooks, settings, skills, `AGENTS.md`, or memory yourself; a human accepts or rejects each proposal.

## Procedure

1. **Read the transcripts.** Session logs for this repository are in `~/.claude/projects/-Users-jun-Development-github-corekraft-kore/*.jsonl`. Take the most recent sessions since the last retrospective noted in `infra/plans/3-agent-harness.md`.
2. **Look for four things**, each with a quote and a transcript file as evidence:
   - an `AGENTS.md` rule that was violated, or that the user had to restate
   - a correction the user repeated across sessions
   - exploration repeated across sessions that a skill could replace
   - a hook block (`[guard:<rule>]`) on legitimate work, a false positive
3. **Propose.** For each finding suggest the smallest change and its layer: hook or deny rule if a script can check it, skill if it is a workflow, `AGENTS.md` if it is judgment, memory if it is a personal fact. A new guard starts in warn mode.
4. **Rank** the proposals by how often the problem occurred, and keep the list short.
5. **Record.** Once the user accepts a proposal, note it in `infra/plans/3-agent-harness.md` or an ADR.
