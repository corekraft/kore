---
status: accepted
summary: On k3d the Gateway Service is a NodePort on a fixed node port, set by the local overlay through a chart-neutral service value; the k3d load balancer maps the host Gateway port to it, so no tunnel runs. Gateway readiness accepts an assigned node port where a LoadBalancer Service would show an address.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0085: The k3d Gateway answers through a node port behind the load balancer

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 4](../../infra/plans/9-k3d-local-cluster.md#step-4-remove-the-tunnel)

Refines: [ADR 0016](0016-release-readiness-checks-drive-wait-and-status.md),
[ADR 0076](0076-k3d-replaces-minikube.md).

## Context

ADR 0076 replaces `minikube tunnel` with the k3d load balancer. k3s ServiceLB is
disabled, so a `LoadBalancer` Service never gets an address, and ADR 0016's
Gateway readiness waits for one. The platform chart must stay provider-neutral,
so it cannot name k3d or a node port itself.

## Decision

- The chart exposes `gateway.service.type` and `gateway.service.nodePort`, both
  unset by default. When set for the Istio class, it renders a
  `kore-gateway-service` ConfigMap that the Gateway names in
  `infrastructure.parametersRef`; Istio merges it into the Service it generates.
- The local overlay sets `NodePort` on node port 30443 and its `k3d.ports` maps
  host 8443 to 30443 on the load balancer. A spec asserts the two agree.
- Gateway readiness treats a `NodePort` Service with an assigned node port as
  published, alongside a `LoadBalancer` address. Nothing else about the check
  changes.
- `platform up` starts no tunnel for k3d, and `local up`, `stop` and `down`
  compose the same domains as before.

## Consequences

The overlay is the one place that knows the node port. With the
`ingress-agentgateway` flag on, the Istio-only overlay is not rendered;
agentgateway takes its own parameters resource, which plan 13 adds when it
replaces the Gateway. The mapping is proven live in #149; until then the Istio
merge of the port is the open risk.
