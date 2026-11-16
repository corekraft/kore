---
status: accepted
summary: Refines ADR 0096: behind the owner-writer flag a writer pane gets the owner's gh login token and the judge a kore-judge App token, so squash commits on main credit the owner; attribution moves to the sender line.
date: 2026-11-16
last-verified: 2026-11-16
---

# ADR 0122: Writer panes act as the owner and the judge is an App

Source: idea 0018 (`docs/ideas/0018-writer-prs-are-authored-by-the-owner-so-main-credits-the-own.md`, corekraft/kore#931)

Refines: [ADR 0096](0096-role-tokens-reach-panes-through-a-fifo-handoff.md)

## Context

ADR 0096 gives the writer a `kore-writer` App token and the judge a machine
user's PAT. A squash commit on main is authored by whoever opened the PR, so
`kore-writer[bot]` took the contribution credit for work the owner directs.
The judge's one approval must come from an identity other than the PR's
author, and GitHub does not count an approval from the PR's own author; once
the writer is the owner, the judge cannot act as the owner, so it moves to an
App of its own.

## Decision

- A new `owner-writer` feature flag
  ([ADR 0077](0077-live-proof-gates-activation-not-merge.md)) in the local
  overlay, off by default, beside `role-tokens`. While it is off, spawn behaves
  as ADR 0096 says.
- With it on, `session spawn` reads the owner's own login token by running
  `gh auth token` in the main session and hands it to the writer pane through
  the existing FIFO. No PAT and no keychain item. When the command fails or
  prints nothing, spawn refuses, tells the owner to run `gh auth login`, and
  splits no pane.
- With it on, the judge pane gets an installation token from a new
  `kore-judge` GitHub App (keychain items `kore.judge.app-id`,
  `kore.judge.installation-id`, `kore.judge.private-key`) with
  pull_requests:write, contents:read and metadata:read on `kore`. The
  `kore.judge.pat` item is no longer read. The App is not the PR author, so
  its approval counts.
- The orchestrator, advisor and principles-review identities are unchanged.
- Who acted is shown by the `sender:` line every harness message carries, not
  by the GitHub login.

## Consequences

- Squash commits on main are authored by the owner.
- The writer acts with the owner's full `gh` login, so the limits on a token in
  the pane's environment (ADR 0096) are wider: it does not expire in an hour.
  The ADR 0095 sandbox is the boundary.
- The flag turns on only after a recorded live run: a writer PR authored by the
  owner, approved by `app/kore-judge`, merged with the owner as the commit author.
