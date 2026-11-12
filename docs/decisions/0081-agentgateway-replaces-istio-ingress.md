---
status: accepted
summary: agentgateway replaces Istio as the Gateway API implementation for ingress; Istio ambient ztunnel stays for workload identity and mTLS; the resource saving is measured afterwards as an outcome.
date: 2026-11-11
last-verified: 2026-11-11
---

# ADR 0081: agentgateway replaces Istio ingress

Source: [`infra/plans/13-agentgateway-ingress.md` § Step 1](../../infra/plans/13-agentgateway-ingress.md#step-1-decide-and-pin)

Refines: [ADR 0006](0006-istio-ambient-gateway-api.md).

## Context

ADR 0006 made Istio ambient the Gateway API implementation, the mesh, and the
source of workload identity. agentgateway is an emerging Gateway API
implementation built for agent and LLM traffic, reported to use far fewer
resources than Envoy-based gateways. It is a gateway, not a mesh: it does not
issue workload identity or mTLS between pods. Kore chooses to adopt emerging
technology here deliberately.

## Decision

agentgateway serves Gateway API ingress. Istio ambient ztunnel stays for
workload identity, mTLS, tenant isolation, and the peer identity OPA receives
(ADRs 0007, 0037, 0066). Adoption is not gated on a prior experiment. The
resource use of the ingress path is measured on k3d after the switch and
recorded as the outcome of the idea. Replacing the mesh as well is a separate
idea, to be raised only with that evidence.

## Consequences

Ingress gains first-class support for MCP, A2A and LLM routes. Two projects now
share the network path, each with one job. The identity chain from ingress to
OPA must be re-proven live, because the gateway that forwards peer identity
changes.
