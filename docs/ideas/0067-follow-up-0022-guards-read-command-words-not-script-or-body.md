---
summary: Follow up on idea 0022 after a inconclusive outcome
hypothesis: After a inconclusive outcome on idea 0022, revisit: If role-no-merge stops refusing harness flag activate --help, and a PR body no longer reaches the guard as command text, writer blocks on legitimate work fall to at most 2 per 14 days
expected-outcome: Since 2026-11-16T14:00Z, the flow report shows 4 role-no-merge blocks, class unclassified; they are the baseline. The earlier 26 of 28 were mostly pre-guidance, before #912 told writers to write multi-line files with the Write tool (2026-11-16). After the help fix and --body-file, the remaining legitimate blocks fall to at most 2 per 14 days
measurement: guardBlocksByRule.role-no-merge in harness flow report; retro-scan --evidence classifies the blocks that remain; the guard corpus passes in CI; a guardrail replay of the window lists the newly allowed commands (an empty list is stated as empty)
safety-pattern: feature-flagged
date: 2026-11-20
parent: 0022
---

# Idea 0067: Follow up: Guards read command words, not script or body text
