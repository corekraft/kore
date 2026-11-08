---
status: accepted
summary: OpenTofu provisions the substrate, Helm installs in-cluster software, controllers reconcile claims, and kore only coordinates them.
date: 2026-09-12
last-verified: 2026-11-08
---

# ADR 0002: Give each upstream tool one responsibility

Source: [`infra/plans/1-initialize.md` § Responsibility Boundaries](../../infra/plans/1-initialize.md#responsibility-boundaries)

## Context

The platform combines OpenTofu, Helm, Kubernetes controllers, Minikube, and
`kubectl`. Each has its own state and reconciliation loop. When two of them
manage the same thing, their states drift and failures become hard to recover
from.

## Decision

- **OpenTofu** provisions infrastructure outside of or required before
  Kubernetes: accounts, networks, managed clusters, node pools, foundational
  IAM, key management, external secret stores, registries, DNS, and state
  storage. It never manages application releases or ordinary in-cluster
  resources.
- **Helm** installs and upgrades software inside Kubernetes. Controllers and
  their CRDs live in dedicated infrastructure charts, separate from application
  charts.
- **Kubernetes controllers** reconcile application claims into
  environment-specific implementations behind a stable contract, normally a
  Kubernetes Secret.
- **Minikube** creates and removes the local cluster; **`kubectl`** observes
  and waits for readiness without owning desired state; **Cosign** signs and
  verifies digests only for authorized release automation.
- **`kore`** composes these tools and never takes over their concerns.
- Minikube specifics stay in local adapters and environment configuration;
  provider specifics stay in OpenTofu modules and environment overlays.

## Consequences

Infrastructure state stays independent of Helm release state and of controller
reconciliation. No resource may be rendered by two Helm releases or by both
Helm and OpenTofu (see [ADR 0011](0011-catalog-owned-releases-and-versions.md)).
Adding a capability means choosing exactly one owning tool for it.
