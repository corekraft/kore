---
status: proposed
summary: vps v1 is every applicable flag on in production, each from its own live proof run with one new flag, taken only from release chart and image locks and run from kore-agents over the tailnet, with no owner waiver on vps, a preflight that names missing prerequisites, and prod changed only by the pipeline and Ansible.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0147: vps v1 is every applicable flag proven live, one per run, from release locks

Source: [issue #1479](https://github.com/corekraft/kore/issues/1479), grilled against the owner interview record in [issue #1478](https://github.com/corekraft/kore/issues/1478) (decisions 1, 2, 3 and 12).

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md), [ADR 0127](0127-an-owner-waiver-recorded-in-an-outcome-counts-as-proof-for-a-flag.md) (narrowed for production), [ADR 0138](0138-publish-signed-configuration-charts-from-main-for-local-proofs.md) (by-convention made enforced) and [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md).

## Context

The owner wants vps to be production: apps delivered safely and never taken down by a change. ADR 0142 left every flag off and said a flag turns on only after its own live run. Four gaps remain: what "v1" is, how a live proof runs on a cluster that is never torn down, which artifacts a managed cluster may take, and who may change it.

## Decision

- **v1 is the manifest's computation** ([ADR 0148](0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md)): every feature flag that applies to vps is on with its own recorded live-run outcome and `harness flag activate`, plus the environment flags vps needs (`in-cluster-ca`, `k3s-registry-trust`, `registry-tailnet-forward`) on with their own outcomes.
- **One new flag per proof run,** in the computed prerequisite order. A red run names its cause, and each flag gets its own outcome from its own run. A flag and the flag it requires are never turned on in one run.
- **Two kinds of run.** A proof run uses kore code and the overlay from the pinned pull request head, with the flag on, and takes every chart and image only from the release chart and image locks (`flag activate` already compares recorded charts with the release lock). The activation pull request then merges unchanged and the cluster stays as the proof left it. A rollout run (every other change) is `kore platform up` from a release tag. Neither uses a main chart lock.
- **Release locks only, enforced.** `kore platform up` for a managed environment refuses a main chart lock until a chart-signature check exists, closing the by-convention gap in ADR 0138.
- **Where proofs run.** Only from kore-agents over the tailnet, as `kore platform up --environment vps` from a clean checkout, one mutation at a time under the per-environment lock. The Mac session records the outcome and runs `flag activate`.
- **No owner waiver on vps.** `flag activate` refuses `--source owner-waiver` for an environment the manifest marks production. This narrows ADR 0127, which stays valid for local.
- **A preflight before the first mutation.** `kore platform up --environment vps` names every missing prerequisite and changes nothing: the vps sops recipient and creation rule, the release chart and image locks, tailnet reachability of the kube context, and a host with no `vps-check` diff.
- **Who may change prod.** Only the pipeline (a judge-merged pull request, then a rollout run from kore-agents, or the Argo CD sync for the configuration phase) and Ansible for the host.
- **Proofs before the first app, a rehearsal after (owner, 2026-11-20).** During v1 activation no app is admitted, so a proof may leave vps degraded until repaired (the repair is the flag back off plus the explicit uninstall of [ADR 0150](0150-platform-releases-reach-vps-by-a-recorded-rollout-and-roll-back-by-revert.md)), and all flags are on before the first app. After the first app, a new platform flag proves first on a rehearsal k3s (the same Ansible role and pinned version in an Incus VM on the host, built only while rehearsing) and reaches prod dark. The rehearsal VM is sized by shrinking the agents VM, which already takes 40 of 64 GiB beside k3s's 20.
- **No by-hand step before a run (owner, 2026-11-20).** The vps sops recipient exists and its creation rule is in the repository. The registry CA reaches the k3s node through the Ansible k3s role ([ADR 0151](0151-host-and-k3s-changes-follow-the-same-safety-patterns-and-run-in-a-maintenance-window.md)), not by an export to the controller.
- **vps needs `platform-argocd-delivery`.** Record decision 7 says Argo CD owns releases; ADR 0142 keeps the flag off on vps so Helm delivers. The flag is activated like any other, and until then rollback goes through the rollout run ([ADR 0150](0150-platform-releases-reach-vps-by-a-recorded-rollout-and-roll-back-by-revert.md)).

## Consequences

- The vps integration spec's all-off assertion and the hardcoded dependency check go (flag manifest ADR).
- A vps proof run changes the live production cluster, so it is only as safe as the proof is small: one flag, release artifacts only.
- Sixteen or so live runs are owed before v1, serialised, each recorded.

## Open owner decisions

- **Break-glass.** A manual kubectl, helm or ssh change to prod is allowed only as break-glass, written up as an issue the same day and reverted to repository state. The wording is new. Recommend yes: it is easily reverted.
- The owner has not yet answered the staleness, soak and window questions in the sibling ADRs.
