---
summary: Give role panes only the context their role needs
hypothesis: If hook context skips the plan session brief when agent_type is a spawned role, and the pane-only AGENTS.md rules move to the orchestrator's skill, role panes start with less context and stop acting on orchestrator steps.
expected-outcome: Tokens per idea fall; the brief (about 4 to 5k characters) stops reaching the 322 writer, 261 judge and 28 reader sessions that all got it, and writer attempts at harness flag activate fall from 16 to 0.
measurement: metrics.tokensPerIdea in harness flow report, with role-no-merge blocks from guardBlocks.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: metrics.tokensPerIdea
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/802
---

# Idea 0014: Give role panes only the context their role needs
