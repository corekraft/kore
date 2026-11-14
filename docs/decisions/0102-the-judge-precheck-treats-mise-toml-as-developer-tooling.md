---
status: accepted
summary: The .mise.toml file only wires the tasks that build, test and check the code, so a diff that edits it alone matches no-behaviour-change without owner approval; this refines ADR 0099.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0102: The judge precheck treats .mise.toml as developer tooling

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)

## Context

ADR 0099 kept `.mise.toml` on the product side, because a pin or a compiler
setting can change what runs. PR #504 was blocked by the precheck over a task
edit in `.mise.toml`, which the owner judged to be developer tooling. The owner
wants developer-tooling changes to merge irrespective of path, so the list in
ADR 0099 names the file.

## Decision

`.mise.toml` is developer tooling under ADR 0099. The precheck matches the file
by its exact path, `.mise.toml` at the repository root. Similarly named files,
such as `mise.toml.bak` or `infra/.mise.toml`, stay product. No other path
moves.

## Consequences

- A diff that edits `.mise.toml` alone matches `no-behaviour-change` without
  owner approval.
- The precheck classifies the whole file, so an edit to its `[tools]` section
  matches the same rule as an edit to a task. That section pins binaries that
  run against clusters (kubectl, helm, k3d, opentofu, sops and others). The
  rule does not separate the two, so a pin change is not caught by the
  precheck. Whether a pin change needs its own rule is an open owner decision;
  until it is taken, the judge reads the diff of any `[tools]` change.
