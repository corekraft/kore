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
  `~/.kore/locks/<cluster>.lock` (`KORE_HOST_ROOT` relocates it; empty counts as unset and a relative path is
  refused), keyed by the
  cluster name. A Lease in the cluster was rejected: it cannot guard `up` on a
  missing or stopped cluster, and it needs a working API server. Mutations
  wait for a live holder (`KORE_LOCK_WAIT_MS`; ten minutes, thirty for `kore local up`,
  which a first-time run takes up to 20 minutes to finish), print one stderr line naming
  the holder's pid, worktree and lock path when the wait starts, then are refused
  naming it.
- **Exclusive host lease.** `kore local up` and the live integration specs
  take `~/.kore/locks/host-lease.lock` before their cluster lock. `session
spawn` refuses a new writer while it is held (enforced). Commit-hook test
  runs only audit it, to stderr and `host-lease-audit.jsonl` beside the test
  lock; enforcing the wait needs the owner's OK.
- **A local image tag per run, with old tags pruned.** The owner decided on
  `kore-local-<12 hex>` for the host build, node import, registry copy and
  digest read-back, so a concurrent build cannot swap the image, and on pruning
  old tags. Tagging by content waits for the reproducible image (#344).
  #344 chose to skip the build rather than make it byte-reproducible: a run
  tags the image `kore-src-<16 hex>` in the registry, from a hash of the app's
  build context (read as docker reads it: `.dockerignore` rules rooted at the
  context, link targets, file modes, length-prefixed fields), the base image
  digests resolved from the Dockerfile's `FROM` lines, and the build platform.
  When that tag exists the run reuses its digest, builds and publishes nothing,
  and still signs again (the key may be new). When any input is unknown, such
  as a base that does not resolve, the run builds and publishes no source tag.
  A build publishes the tag only if the inputs are unchanged after it, so an
  edit during the build cannot leave the old tag on the new image. A registry
  answer other than found or not found fails the run.
  **#353 must treat every `kore-src-*` tag as a root and never garbage-collect
  a digest a pod uses or a `kore-src-*` tag names**; deleting such a digest
  makes the next run reuse an image the registry no longer has.
  `kore local up` prunes, before it builds and only while it holds the host
  lease, kore's own tags (the per-run tags and the old shared `kore-local`) on
  every node of its cluster and on the host, and only those no pod in the
  cluster uses; it removes nothing if the pods cannot be listed. **Registry
  pruning is built behind the `registry-tag-pruning` flag, off in every
  environment overlay** ([#353](https://github.com/corekraft/kore/issues/353)).
  With the flag on, `kore local up` also deletes per-run tags
  (`kore-local-<12 hex>`) older than a seven-day keep window, after the node and
  host prune and under the same host lease, then runs the registry's garbage
  collection once if it deleted anything. A registry delete removes every tag on
  a digest, so a digest is spared when a pod uses it (by digest or by a tag it
  names), when `images.lock.json` or the environment's local lock references it,
  or when any other tag names it: every `kore-src-*` source tag, the old
  `kore-local` tag and every per-run tag still inside the window. It deletes
  nothing when the pods or a lock cannot be listed or read, nothing without the
  lease, and nothing at all with the flag off, which is the default. The flag
  turns on the registry's `REGISTRY_STORAGE_DELETE_ENABLED` in the chart; the
  push identity is the prune identity and is already the only one the auth
  proxy lets write, so the proxy is unchanged and a flag-off render is
  byte-identical to before (no pod roll). **The flag stays off until a live
  run shows the registry's disk use flat across repeated `kore local up` runs**;
  that run is owed on #353, and the flag turns on only through the harness's
  flag activation, after that run is recorded. The garbage-collect command path
  (`/etc/distribution/config.yml`) and the age read from each image's config
  `created` field are unproved until that run.
- **An owner for the registry forward.** The starting process and its worktree
  are recorded at `~/.kore/registry-forward/<context>.json`. Another worktree's
  stop, or another kore process's stop in the owning worktree, leaves a running
  forward alone and names its owner; the starting process or `--force` (on
  `platform stop|destroy` and `local down`) stops it. An unrecorded forward, one
  whose owner worktree is gone, or one whose starting process has exited is
  stopped as before. A forward
  found already open with no record is reported, not adopted silently.
- **State per environment.** The signing public key, local image lock and API
  token live under `.kore/state/environments/<environment>/`.

## Consequences

- A checkout that already has `.kore/state/reference-api-token` generates a
  new token for the new path only when the cluster's source Secret is also
  missing; otherwise the cluster keeps its Secret. The old files are unused
  and can be deleted.
- Locks guard one host only, which suits k3d.
- Each change is cluster-facing, so each needs a live run before merge.
