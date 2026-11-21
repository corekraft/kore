---
status: proposed
summary: A release rolls back through its owner (a git revert of the record for Argo CD releases, a reverted lock and a platform up for kore-owned Helm releases, never helm rollback under Argo CD), a revert keeps its image, a contract step waits for a per-rollout soak, and host maintenance never drains, with only the kernel reboot waiting for the Sunday 04:00 window.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: Rollback goes through the release owner and host maintenance never drains

Source: [`infra/plans/15-next-horizon.md` § Step 5](../../infra/plans/15-next-horizon.md#step-5-platform-argo-cd-delivery-from-git)

Builds on [ADR 0043](0043-platform-configuration-through-argo-cd.md) (the catalog names each release's owner), [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md) and [ADR 0094](0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md).

Status is `proposed`. It was settled in shape in the grilling of issue #1480 against the owner interview record of #1478 (decisions 3, 6, 7, 8); the owner then decided the parked numbers on #1480 (2026-11-20), and they are recorded below. The ADR stays `proposed` until the owner accepts it.

## Context

The owner first said "helm rollback to the last revision". Under Argo CD that breaks one owner per resource, and self-heal undoes it (decision 7). The record's premise is also not yet true: `platform-argocd-delivery` is false in the vps overlay, so Helm delivers its releases there until the flag is activated. And Argo CD owns only the apps and the configuration phase; the bootstrap, core and observability phases and the image policy stay with kore and Helm (ADR 0043), where Helm's `--rollback-on-failure` is the failure path.

A revert also needs the previous image. Images live only in the in-cluster registry on the same disk, and `registry-tag-pruning` deletes old tags. A plain `kubectl drain` hangs on a single node: the PodDisruptionBudget blocks the second eviction, and cordoning leaves nowhere for a replacement to go. Nothing in the repository creates the file that says a reboot is required.

## Decision

- **Rollback goes through the owner.** An Argo CD release (apps, the configuration phase) rolls back by a `git revert` of its record, or a flag turned off. A kore-owned Helm release rolls back by reverting the lock and running `kore platform up`; Helm's own `--rollback-on-failure` on a failed upgrade stays. A `helm rollback` under Argo CD is never used.
- **A failed rollout is reverted, not progressed.** No progressive-delivery controller joins v1; a new controller is an architectural decision. With `maxUnavailable: 0` a bad image stalls while the old pods keep serving. A rollout that misses its progress deadline is a failed release, and the platform reverts it by opening a git revert of the record, so git stays the owner. Who opens it and who merges it belong to the delivery concept, #1485.
- **A revert keeps its image.** Registry tag pruning stays off on vps until it keeps the current digest, the last 3 distinct digests per service, every digest whose soak has not ended, every digest a pod runs, and each kept digest's signatures and attestations; the registry's garbage collection then sweeps the rest.
- **Contract waits for the soak.** The soak is a configurable per-rollout primitive in the app record: `soak.duration`, default 24 hours with no minimum (a duration under 30 minutes raises an audit warning), and an optional `soak.minRequests`, default off. A contract step is refused before the soak ends. What passes a soak stays platform-owned; the clock and the evidence belong to the delivery concept. The 14-day soak ADR 0147 (#1488) proposes for retiring a flag is a different clock.
- **Maintenance never drains.** k3s restarts in place; chart and k3s upgrades are zero-downtime and may run at any time, once a drill has a recorded pass: restart k3s under the zero-failed-requests probe and record the outcome. Ansible runs in check mode first, serialized per environment, and the sync window below keeps app syncs out.
- **Only the kernel reboot waits.** `unattended-upgrades` keeps installing and never reboots; the base role installs `reboot-notifier` so `/var/run/reboot-required` exists after a kernel update. A reboot is an Ansible-run, announced window, weekly on Sunday at 04:00 in the owner's time, only when that file exists. The run stops the delivery tick and the agent panes first, because the agents VM shares the host and dies with it, reboots, and runs the readiness check.
- **A reboot is a clean, short outage.** Kubelet graceful node shutdown runs `preStop` and a critical-pod slice. An Argo CD AppProject sync window denies syncs from before the reboot until every release is Ready, so no rollout is half-applied. The sync window exists once `platform-argocd-delivery` is active.
- **Recovery without a hand is drilled.** A recorded cold-boot drill on vps: reboot in a window, require every platform release Ready with no hand (including the fail-closed policy controller coming up before any pod it must admit), and record the time to Ready. The outage budget is a 10-minute ceiling for the first drill; after three drills it is the slowest measured time plus 50 percent, never above 10 minutes. It covers the platform, not the agents VM.

## Consequences

- Both owner-split rollbacks need their guards: nothing may run `helm rollback` against an Argo CD release, and a lock revert must reproduce the previous state.
- A contract release cannot be reverted past its expand step; that is why it waits.
- The weekly window costs the delivery loop its host for a short time; the tick is stopped first and resumes after.
- The reboot-notifier's daily mail goes nowhere until mail is set up; the sentinel file is what the playbook reads.
- The recorded drills are owed on kore-vps and gate the flags that depend on them.
