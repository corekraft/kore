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

Resumed behind the flag (2026-11-12, #126): after the #261 live proof the plan
paused until the outcome was measured. The owner lifted that pause for the
replacement, its identity re-proof and the measurement, with the flag off in
`local`; activating it in `local` waits for a measured drop of at least 20% in
median ingress CPU or memory.

Rollback stays operator-run (2026-11-15, #207): Kore refuses to reconcile a
gated-off release that is still installed, and uninstalling `agentgateway-crds`
deletes the CRDs and their custom resources, so the operator runs the two
`helm uninstall` steps after `kore local up` (plan 13, Step 2).
The refusal moves later under the class-change flag (2026-11-15, #207 live
run 5, #126): up front, the refusal stopped the run before
`kore-platform-config` could be re-rendered with the flag off, while removing
the CRDs first broke Helm's old release manifest (the `AgentgatewayParameters`
kind was missing). So with its own flag `gateway-rollback-order` on (off in every committed overlay; `gateway-class-change-release` keeps gating only the class change), `kore local up`
reconciles every component first and then refuses, still naming the
`helm uninstall` steps and still exiting non-zero; Helm itself removes Kore's
`AgentgatewayParameters` as platform-config re-renders. With the flag off the
refusal stays up front, with no Helm call before it. Kore still never
uninstalls CRDs; that consent stays with the operator. This supersedes the
earlier note that the live proof deletes that object by hand.

Addendum, 2026-11-15 (#208 live run 6, #126): the agentgateway data plane is
enrolled in the ambient mesh by its own flag `agentgateway-mesh-enrollment`
(off in every committed overlay). The live run showed the `kore-gateway` pod
outside the mesh while `kore-system` and `reference` use STRICT mTLS, so
ztunnel denied its plaintext connection to the frontend and the gateway
answered 503. Only the data-plane pod is enrolled, not `kore-system`: an
enrolled pod gets STRICT inbound, so the load balancer's plaintext connection
to the gateway port would break, and enrolling the namespace would change every
other workload in it. Verified against agentgateway v1.7.0: the generated pod
copies `Gateway.spec.infrastructure.labels` into its labels, so the pod label is
set there, which works whether or not the environment publishes a Service
through `AgentgatewayParameters` (the CRD's `deployment.spec` overlay could also
carry it, but only with that resource present); the pod runs as the
ServiceAccount named after the Gateway (`kore-gateway`, so its identity is
`spiffe://cluster.local/ns/kore-system/sa/kore-gateway`, stable for ADR 0066);
and the container port equals the listener port, so `.Values.gateway.port`
is the pod's real port (the controller sets the unprivileged-port sysctl to 0,
so 443 needs no remap). A second `PeerAuthentication`, `kore-gateway-listener`,
selects the gateway pod, stays STRICT and sets `PERMISSIVE` for the listener
port only, the same exposure the Istio gateway has today. Workload-to-workload
mTLS, the namespace default, `default-deny` and `gateway-allow-https` are
untouched. Both resources render only for the agentgateway class with the flag
on. The identity chain (ADR 0066) is re-proven by the #208 suites, which this
change does not claim to pass.
