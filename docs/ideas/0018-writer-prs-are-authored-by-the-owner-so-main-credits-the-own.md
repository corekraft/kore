---
summary: Writer panes act as the owner and the judge approves through its own kore-judge App, so squash commits on main count toward the owner's contributions
hypothesis: If session spawn gives a writer pane the owner's own gh CLI login token (read with gh auth token at spawn, no PAT or keychain item) instead of a kore-writer App token, and a judge pane a kore-judge App installation token instead of the judge PAT, which is then retired (owner-writer flag), squash commits on main are authored by the owner, and the judge's approval still meets the one-approval ruleset because the PR author and the approver are different identities. Attribution moves to the sender line every harness comment already carries.
expected-outcome: A --worktree writer spawn opens a PR authored by junners, harness judge approve posts an approval from app/kore-judge that the main ruleset counts, and the squash commit on main has junners as its author.
measurement: On one live writer PR: the PR author login, the approving reviewer login and state, mergeStateStatus before merge, and the author email of the resulting main commit.
safety-pattern: feature-flagged
date: 2026-11-16
---

# Idea 0018: Writer PRs are authored by the owner so main credits the owner
