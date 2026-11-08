---
status: accepted
summary: Istio in ambient mode implements Gateway API, the mesh, and workload identity; Envoy Gateway is not used; cert-manager issues certificates from environment-selected issuers.
date: 2026-09-12
last-verified: 2026-11-07
---

# ADR 0006: Use Istio ambient as the Gateway API implementation

Source: [`infra/plans/1-initialize.md` § Initial Tool Selection](../../infra/plans/1-initialize.md#initial-tool-selection)
and [§ Networking and Certificates](../../infra/plans/1-initialize.md#networking-and-certificates)

## Context

The platform needs ingress, service-to-service mutual TLS, workload identity,
runtime authorization, and mesh telemetry. Running a separate gateway
controller next to a mesh would add a second control plane with overlapping
responsibilities.

## Decision

- Istio in ambient mode implements Kubernetes Gateway API for ingress and the
  mesh. Envoy Gateway is not part of the initial stack.
- Application charts use only standard Gateway API resources. They never
  invoke Minikube or name an Istio `GatewayClass`; environment configuration
  supplies infrastructure-owned parent references. Istio-specific networking
  resources stay infrastructure-owned and are used only where the standard API
  cannot express a requirement.
- Minikube tunnel management stays behind `kore`.
- cert-manager provides the `Certificate` contract everywhere. Locally it uses
  a CA established with mkcert; managed environments substitute an ACME or
  provider issuer.

## Consequences

One control plane covers ingress, mesh, identity, and authorization. Envoy
Gateway is reconsidered only if edge ownership, release isolation, or advanced
API-gateway needs justify operating both. Local bootstrap ordering is refined
by [ADR 0013](0013-local-tls-before-gateway.md).
