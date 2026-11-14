---
status: accepted
summary: A lint rule cannot change what runs, so a diff that edits tools/kore/.oxlintrc.json alone matches no-behaviour-change; this refines ADR 0099.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0103: The judge precheck treats the kore lint config as developer tooling

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)

## Context

ADR 0099 keeps the `tools/kore` lint configuration out of the tooling list, so
the precheck reads a change to `tools/kore/.oxlintrc.json` as product. A scoped
lint override there, such as the one in PR #554, would be sent back with
`patternMismatch`. A lint rule only reports on source code; it cannot change
what a user or a cluster runs.

## Decision

`tools/kore/.oxlintrc.json` is developer tooling under ADR 0099. The precheck
matches the file by its exact path, at the `tools/kore` root. Similarly named
files, such as `tools/kore/.oxlintrc.jsonc-extra`, or a lint config in a
subfolder such as `tools/kore/src/.oxlintrc.json`, stay product. No other path
moves.

## Consequences

- A diff that edits `tools/kore/.oxlintrc.json` alone matches
  `no-behaviour-change` without owner approval.
- The rule covers the whole file. A lint setting that changes what the compiler
  or the build emits, rather than what the linter reports, is not separated
  from a rule change by the precheck.
- `tools/harness/` already matches the tooling list, so its lint configuration
  needs no change.
