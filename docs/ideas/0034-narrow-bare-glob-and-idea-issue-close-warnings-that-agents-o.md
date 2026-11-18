---
summary: Narrow bare-glob and idea-issue-close warnings that agents override
hypothesis: If bare-glob (9 of 110 overridden) and idea-issue-close (9 of 114 overridden, often a legitimate close with comment after merge) were tuned to skip these shapes, warning noise falls without losing the heeded cases
expected-outcome: Warnings on these two rules fall by at least 50 percent while heeded rate stays at or above 90 percent
measurement: guardBlocksByRule.bare-glob in harness flow report plus rules.audit overridden counts in retro-scan
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: guardBlocksByRule.bare-glob
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0034: Narrow bare-glob and idea-issue-close warnings that agents override
