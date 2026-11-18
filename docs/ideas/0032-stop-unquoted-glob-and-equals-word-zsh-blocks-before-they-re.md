---
summary: Stop unquoted-glob and equals-word zsh blocks before they reach the guard
hypothesis: If the guard message gave the exact quoted rewrite, or AGENTS.md said to quote globs and to avoid lines starting with = (such as ==== separators), agents stop issuing these commands
expected-outcome: unquoted-glob blocks (42) and equals-word blocks (22) each fall by at least half
measurement: guardBlocksByRule.unquoted-glob and guardBlocksByRule.equals-word in harness flow report
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: guardBlocksByRule.unquoted-glob
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0032: Stop unquoted-glob and equals-word zsh blocks before they reach the guard
