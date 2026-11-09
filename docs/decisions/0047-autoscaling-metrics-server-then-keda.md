---
status: accepted
summary: metrics-server is installed first as a catalog Helm release and services get CPU-based HorizontalPodAutoscaler defaults from their chart values, without a replica count, with at least two replicas and a disruption budget; KEDA follows later for request-rate scaling.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0047: Autoscale on metrics-server first, then KEDA

Source: [`docs/vision.md` § Backend for Frontend](../vision.md#backend-for-frontend)

## Context

BFFs must scale horizontally, and the catalog has no metrics source, so the
HorizontalPodAutoscaler has nothing to read. KEDA scales on richer signals,
such as request rate, and can scale to zero, but it is another controller and
a cold first request would break the vision's success measure that no request
fails on a cold pod. A workload's replica count also needs one owner: the
autoscaler, not Helm or Argo CD.

## Decision

- **metrics-server first, through Helm.** metrics-server is a catalog release
  installed from its pinned Helm chart by `kore`, with a readiness check that
  its metrics API is available. An environment whose provider already runs
  one disables the release in its overlay, so there is one owner.
- **Autoscaling defaults live in chart values.** The service workload chart
  creates a CPU-based HorizontalPodAutoscaler with at least two replicas and a
  PodDisruptionBudget, and leaves the replica count out whenever autoscaling is
  on, so Helm and Argo CD never fight the autoscaler.
- **KEDA after.** KEDA is added later for scaling on request rate from
  Prometheus. A service that opts in gets a KEDA ScaledObject in place of the
  chart's autoscaler, never both.
- **No scale to zero by default.** BFFs keep their minimum replicas.

## Consequences

- metrics-server also makes `kubectl top` work for operators.
- Local Minikube uses the catalog release, not the Minikube addon.
- Adding KEDA is a new catalog release with its own ADR and readiness checks.
