---
status: accepted
summary: Locks live at a host path keyed by cluster, live runs hold an exclusive host lease, local images get a tag per run, the registry forward has an owner, and per-environment state is keyed by environment.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0094: Worktrees sharing a cluster share its locks, tags and forward

Source: [`infra/plans/12-self-improving-loop.md`](../../infra/plans/12-self-improving-loop.md)

## Context

Many worktrees run against one k3d cluster. The toil retro (item 5, issue
#340) found the environment lock per worktree, the local image tag
`kore-local` shared and mutable, one registry port-forward that any worktree's
stop could kill, and `.kore/state` files shared by every environment in a
checkout. Load peaked near 249 on 12 cores, kine crashed twice, and a fresh
`kore local up` took 2,679 s under load against 252 s quiet.

## Decision

- **Cluster lock at a host path.** The environment lock is
  `~/.kore/locks/<cluster>.lock` (`KORE_HOST_ROOT` relocates it), keyed by the
  cluster name. A Lease in the cluster was rejected: it cannot guard `up` on a
  missing or stopped cluster, and it needs a working API server. Mutations
  wait for a live holder (`KORE_LOCK_WAIT_MS`, ten minutes), then are refused
  naming it.
- **Exclusive host lease.** `kore local up` and the live integration specs
  take `~/.kore/locks/host-lease.lock` before their cluster lock. `session
  spawn` refuses a new writer while it is held (enforced). Commit-hook test
  runs only audit it, to stderr and `host-lease-audit.jsonl` beside the test
  lock; enforcing the wait needs the owner's OK.
- **A local image tag per run.** `kore-local-<12 hex>` for the host build,
  node import, registry copy and digest read-back, so a concurrent build
  cannot swap the image. Tagging by content waits for the reproducible image
  (#344). The host tag is removed after signing; registry tags stay, as
  deleting by digest could remove a deployed image.
- **An owner for the registry forward.** The starting worktree is recorded at
  `~/.kore/registry-forward/<context>.json`. Another worktree's stop leaves a
  running forward alone and names its owner; an unrecorded forward or one
  whose owner worktree is gone is stopped as before.
- **State per environment.** The signing public key, local image lock and API
  token live under `.kore/state/environments/<environment>/`.

## Consequences

- A checkout that already has `.kore/state/reference-api-token` generates a
  new token for the new path only when the cluster's source Secret is also
  missing; otherwise the cluster keeps its Secret. The old files are unused
  and can be deleted.
- Locks guard one host only, which suits k3d.
- Each change is cluster-facing, so each needs a live run before merge.
