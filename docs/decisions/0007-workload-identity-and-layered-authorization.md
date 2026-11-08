---
status: accepted
summary: Workload identity comes from dedicated ServiceAccounts as Istio SPIFFE principals; native Istio policy handles common rules and a platform-operated OPA-Envoy service handles contextual decisions, failing closed.
date: 2026-09-12
last-verified: 2026-11-08
---

# ADR 0007: Derive identity from ServiceAccounts and layer authorization

Source: [`infra/plans/1-initialize.md` § Workload Identity and Authorization](../../infra/plans/1-initialize.md#workload-identity-and-authorization)

## Context

Authorization decisions need a cryptographic workload identity. Some rules are
simple service-to-service allows and denies; others need request context or
shared policy. OPA must not become an identity issuer, and sidecars would break
the ambient data-plane model.

## Decision

- Every workload uses a dedicated Kubernetes ServiceAccount. Istio turns it
  into a short-lived identity
  `spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>` and enforces
  mutual TLS.
- Native Istio `ALLOW` and `DENY` policies handle common rules, with default
  deny and explicit allow.
- A platform-operated OPA-Envoy service, not injected sidecars, makes
  contextual Layer 7 decisions delegated through Istio `CUSTOM` policies.
  Protected routes fail closed when it is unavailable. Rego ships as versioned
  bundles, tested independently of application releases.
- OPA Gatekeeper validates workload shape at admission: dedicated
  ServiceAccount, explicit token mounting, no wildcard RBAC, ambient
  enrollment, required labels, resources and probes, no privileged containers,
  no plaintext Secrets, and retention on stateful claims. Constraints start in
  audit mode and are promoted one at a time after the platform complies.
  System namespace exemptions are explicit and minimal.

## Consequences

Identity, authorization, and admission each have one owner. The OPA input
contract is refined by [ADR 0014](0014-native-identity-before-opa.md).
