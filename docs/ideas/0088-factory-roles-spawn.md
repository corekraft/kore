---
summary: Moves the factory role definitions from .claude/factory into .claude/agents behind the factory-roles flag, each with a guard group, keeping the live roles' harness commands.
hypothesis: Giving each factory role a definition, a guard group and its ported lab cases lets session spawn start it safely, with read-only roles able to consult a reader and nothing else.
expected-outcome: With factory-roles on in local, session spawn starts each of the eleven roles, every guard corpus case passes, and the ported lab cases pass in the eval suite.
measurement: Run the guard corpus and the eval suite with the flag on in local, and spawn each role once on kore-agents.
safety-pattern: feature-flagged
date: 2026-11-24
issue: https://github.com/corekraft/kore/issues/2019
---

# Idea 0088: The factory roles start through session spawn with their own guards
