---
summary: Cut role-read-only blocks on read-only reader panes
hypothesis: If the role-read-only guard allowed the common read-only forms readers reach for (for-loops over numbers, command substitution around known read-only commands, guardrail status --json), readers stop retrying blocked commands
expected-outcome: role-read-only blocks fall from 50 per scan window to under 10
measurement: guardBlocksByRule.role-read-only in harness flow report, trailing window
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: guardBlocksByRule.role-read-only
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0031: Cut role-read-only blocks on read-only reader panes
