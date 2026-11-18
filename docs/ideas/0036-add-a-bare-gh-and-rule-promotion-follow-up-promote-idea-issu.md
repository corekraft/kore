---
summary: Add a bare gh and rule-promotion follow-up: promote idea-issue-body to enforce
hypothesis: If idea-issue-body is promoted to enforce (6 warnings, 6 heeded, 0 overridden in 3 sessions), the bad body shape never reaches an issue; also writers ran bare gh 7 times in 6 sessions
expected-outcome: idea-issue-body warnings drop to 0 with no false positives
measurement: guardBlocksByRule.idea-issue-body in harness flow report
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: guardBlocksByRule.idea-issue-body
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0036: Add a bare gh and rule-promotion follow-up: promote idea-issue-body to enforce
