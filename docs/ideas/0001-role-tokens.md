---
summary: Role tokens give writer and judge panes their own GitHub identities
hypothesis: If session spawn mints a kore-writer App installation token for writers and reads the judge PAT for judges (role-tokens flag), writer PRs are authored by the App and the judge can approve them with its own token.
expected-outcome: A --worktree writer spawn opens a PR authored by the kore-writer App, and a judge spawn approves it through harness judge approve.
measurement: PR author login on a writer-opened PR, and the reviewer login and state on the judge's approval of it.
safety-pattern: dark-launched
date: 2026-11-14
issue: 355
outcome: confirmed
---

# Idea 0001: Role tokens give writer and judge panes their own GitHub identities

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: role-tokens
- Environment: local
- Evidence: https://github.com/corekraft/kore/pull/603
- Recorded: 2026-11-14

With role-tokens on in the local overlay (PR 602), a --worktree writer spawn (token-proof-writer) opened PR 603 authored by app/kore-writer, and a judge spawn (token-proof-approver) ran harness judge approve 603 (PR 604) and the approval posted on 603 with reviewer login junners. Identity note: that login is the owner account, so the judge PAT acts as the owner; approvals of app/kore-writer PRs still satisfy the one-approval rule but judge and owner are not separate identities (owner accepted this on #336).
