---
status: proposed
summary: A release rolls back through its owner (a git revert of the record for Argo CD releases, a reverted lock and a platform up for kore-owned Helm releases, never helm rollback under Argo CD), a revert keeps the previous image, a contract step waits for the soak, and host maintenance never drains, with only the kernel reboot waiting for a scheduled window.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: Rollback goes through the release owner and host maintenance never drains

Source: [`infra/plans/15-next-horizon.md` § Step 5](../../infra/plans/15-next-horizon.md#step-5-platform-argo-cd-delivery-from-git)

Builds on [ADR 0043](0043-platform-configuration-through-argo-cd.md) (the catalog names each release's owner), [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md) and [ADR 0094](0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md).

Status is `proposed`: settled in shape in the grilling of issue #1480 against the owner interview record of #1478 (decisions 3, 6, 7, 8). Each number the owner has not decided is an open placeholder, never filled in.

## Context

The owner first said "helm rollback to the last revision". Under Argo CD that breaks one owner per resource, and self-heal undoes it (decision 7). The record's premise is also not yet true: `platform-argocd-delivery` is false in the vps overlay, so Helm delivers its releases there until the flag is activated. And Argo CD owns only the apps and the configuration phase; the bootstrap, core and observability phases and the image policy stay with kore and Helm (ADR 0043), where Helm's `--rollback-on-failure` is the failure path.

A revert also needs the previous image. Images live only in the in-cluster registry on the same disk, and `registry-tag-pruning` deletes old tags. The plain `kubectl drain` hangs on a single node: the PodDisruptionBudget blocks the second eviction, and cordoning leaves nowhere for a replacement to go.

## Decision

- **Rollback goes through the owner.** An Argo CD release (apps, the configuration phase) rolls back by a `git revert` of its record, or a flag turned off. A kore-owned Helm release rolls back by reverting the lock and running `kore platform up`; Helm's own `--rollback-on-failure` on a failed upgrade stays. A `helm rollback` under Argo CD is never used.
- **A failed rollout is reverted, not progressed.** No progressive-delivery controller joins v1; a new controller is an architectural decision. With `maxUnavailable: 0` a bad image stalls while the old pods keep serving. A rollout that misses its progress deadline is a failed release, and the platform reverts it by opening a git revert of the record, so git stays the owner. Who opens it and who merges it belong to the delivery concept, #1485.
- **A revert keeps its image.** `registry-tag-pruning` stays off on vps until it retains what a revert needs: the last digests per service plus every digest named by a record younger than the soak. **The number of digests is an open owner decision; the recommendation is 3.**
- **Contract waits for the soak.** A soak is a platform-set minimum time since activation with no revert and no failed health, a field of the app record schema; a contract step is refused before it ends. The clock and the evidence belong to the delivery concept. **The default length is an open owner decision; the recommendation is 7 days, spanning one maintenance window.**
- **Maintenance never drains.** k3s restarts in place; chart and k3s upgrades are zero-downtime and may run at any time, once a drill has a recorded pass: restart k3s under the zero-failed-requests probe and record the outcome. Ansible runs in check mode first, serialized per environment, and the same sync window below keeps app syncs out.
- **Only the kernel reboot waits.** `unattended-upgrades` keeps installing and never reboots. A reboot is an Ansible-run, announced window, only when `/var/run/reboot-required` exists, that first stops the delivery tick and the agent panes, because the agents VM shares the host and dies with it. **The window is an open owner decision; the recommendation is weekly, Sunday 04:00 in the owner's timezone.**
- **A reboot is a clean, short outage.** Kubelet graceful node shutdown runs `preStop` and a critical-pod slice. An Argo CD AppProject sync window denies syncs from before the reboot until every release is Ready, so no rollout is half-applied. The sync window exists once `platform-argocd-delivery` is active.
- **Recovery without a hand is drilled once.** One recorded cold-boot drill on vps: reboot in a window, require every release Ready with no hand (including the fail-closed policy controller coming up before any pod it must admit), and record the time to Ready. **The acceptable outage budget is an open owner decision; the recommendation is 10 minutes, tightened after the first drill.**

## Consequences

- Both owner-split rollbacks need their guards: nothing may run `helm rollback` against an Argo CD release, and a lock revert must reproduce the previous state.
- A contract release cannot be reverted past its expand step; that is why it waits.
- The weekly window costs the delivery loop its host for a short time; the tick is stopped first and resumes after.
- The recorded drills are owed on kore-vps and gate the flags that depend on them.
