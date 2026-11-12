---
status: accepted
summary: The local environment runs on k3d instead of Minikube; the k3d load balancer replaces the tunnel, k3s local-path replaces minikube-hostpath, and Kore keeps its own registry.
date: 2026-11-11
last-verified: 2026-11-11
---

# ADR 0076: Run the local environment on k3d, not Minikube

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 1](../../infra/plans/9-k3d-local-cluster.md#step-1-decide-the-mapping)

Refines: [ADR 0012](0012-environment-overlays-hold-provider-specifics.md),
[ADR 0015](0015-local-signed-image-delivery.md),
[ADR 0060](0060-tunnel-recovery-on-demand.md),
[ADR 0065](0065-restart-readiness-and-transient-kubectl-retry.md).

## Context

Minikube makes the development machine lag badly while the local environment
runs. It also brings a separate tunnel process that Kore has to recover on
demand (ADR 0060), node access over `minikube ssh` for registry trust, and a
storage provisioner that exists only on Minikube. About 20 modules branch on
`provider === "minikube"`. k3d runs k3s in Docker with a lighter footprint, a
built-in load balancer that maps ports to the host, and a standard local-path
provisioner.

## Decision

Replace Minikube with k3d for the local environment. The provider value becomes
`k3d`. The mapping is:

- `minikube image load` becomes `k3d image import`.
- The k3d load balancer's port mapping replaces `minikube tunnel`; the `tunnel`
  domain is deleted.
- k3s `local-path` replaces `k8s.io/minikube-hostpath`.
- k3s's bundled Traefik and ServiceLB are disabled; Kore owns the gateway.
- Kore keeps its own in-cluster TLS registry; k3d's managed registry is not
  used, so the registry has one owner.
- Node trust for the registry CA is set through k3s `registries.yaml` at
  cluster create, not over ssh.
- k3d and the k3s image are pinned in `.mise.toml` and `versions.yaml`.

There is no migration path for existing local data. The operator deletes the
old Minikube profile once, by hand; the deny rule on `minikube delete` moves to
`k3d cluster delete`.

## Consequences

The tunnel recovery logic, its status row, and ADR 0060 go away with the
`tunnel` domain. Every module that branched on Minikube switches to k3d, and
the live proof suites must pass on k3d before the switch merges. Existing
Minikube profiles are abandoned, not migrated.
