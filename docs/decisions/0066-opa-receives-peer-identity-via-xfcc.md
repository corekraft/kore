---
status: accepted
summary: OPA gets the authenticated source principal from an x-forwarded-client-cert header that the Istio 1.31 ambient waypoint synthesizes from ztunnel's peer identity (opt-in Gateway annotation), and the Rego requires it; platform controller namespaces are exempt from the container-security constraint by name.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0066: Peer identity reaches OPA through XFCC; platform namespaces are exempt from container security

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md#step-9-workload-identity-application-image-trust-and-policy)

Refines: [ADR 0014](0014-native-identity-before-opa.md),
[ADR 0059](0059-identity-policy-evidence.md)

## Context

ADR 0014 recorded that ambient waypoint ExtAuthz requests carry no
`attributes.source.principal` or `attributes.destination.principal`. That is
structural, not a version gap: mTLS ends on the waypoint's HBONE listener, so
Envoy's ext_authz filter sees no peer certificate. The first live run of the
identity specs on Istio 1.31.4 confirmed both fields are still absent.

Istio 1.31.4's waypoint (`pilot/pkg/networking/core/listener_waypoint.go`) can
synthesize `x-forwarded-client-cert` from the ztunnel-provided identity
(`By=` the waypoint's principal, `URI=` the authenticated caller) when the
Gateway carries `ambient.istio.io/xfcc-include-client-identity: "true"`. The
filter overwrites any caller-supplied value and runs before the `CUSTOM`
ext_authz filter. The gRPC ext_authz provider forwards every request header,
so no mesh-config change is needed.

The live container-security audit reported 24 violations. Rendering every
pinned chart showed none in kore-owned charts. They come from third-party
controller charts that set no CPU request or readiness probe (cert-manager,
crossplane, external-secrets, cloudnative-pg, grafana, prometheus, tempo) and
from minikube's privileged `kube-proxy` in `kube-system`. Istio's gateway and
waypoint Deployments already default to a CPU request and a readiness probe.

## Decision

- Waypoint Gateways that front an OPA `CUSTOM` policy set
  `infrastructure.annotations: ambient.istio.io/xfcc-include-client-identity: "true"`.
- `envoy.authz` derives `source_principal` from the `URI=` element of
  `x-forwarded-client-cert` (a `spiffe://cluster.local/ns/*/sa/*` identity)
  and `allow` requires it. A request without an authenticated principal is
  denied, so a missing annotation fails closed. The native Istio `ALLOW` policy
  from ADR 0014 stays; OPA's decision now also sees the identity.
- OPA still receives no `attributes.source.principal`. The destination side
  is the waypoint's own identity (`By=`), not the backend workload's.
- `kore-container-security` takes `exemptNamespaces`: `kube-system`,
  `cert-manager`, `gatekeeper-system`, `istio-system`, `crossplane-system`,
  `external-secrets`, `cnpg-system`, `opentelemetry-operator-system`,
  `observability`. These hold upstream controllers we do not author. Kore-owned
  namespaces (`kore-system`, `kore-registry`, `opa-system`, `cosign-system`)
  and application namespaces stay covered; each exemption and each covered
  namespace has an offline fixture.

## Consequences

Promotion evidence for container security means zero violations in what the
constraint covers, not in third-party controllers. Giving those charts
resource requests and probes through pinned values is a separate change that
needs its own live proof, and would allow shrinking the exemption list.
