---
status: accepted
summary: The Kubernetes plugin reads Argo CD Applications and Deployments with the Backstage service account while the operators-only permission policy decides who may ask, because the local apiserver cannot accept Keycloak tokens.
date: 2026-11-23
last-verified: 2026-11-23
---

# ADR 0180: Backstage reads the Argo CD view as its own service account, gated by the operators policy

Source: [`infra/plans/15-next-horizon.md` § Step 6](../../infra/plans/15-next-horizon.md#step-6-platform-keycloak-and-backstage)

Refines: ADR 0111

## Context

[ADR 0111](0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md)
had Backstage's Kubernetes plugin read clusters as the signed-in user, with
their Keycloak token, so Kubernetes RBAC applied. A live check of plan 15 Step 6
item 3 found that the local k3d apiserver sets no OIDC argument, so it cannot
accept that token, and the platform's only cluster is created before its Keycloak
and local CA exist. Making the apiserver accept the realm would need a cluster
recreate, host aliases in the node and the CA mounted at creation.

## Decision

The Kubernetes plugin reads with Backstage's own service account
(`authProvider: serviceAccount`, a long-lived service account token Secret).
Who may ask is decided by Backstage's permission policy, which already allows
only members of `platform-operators` and denies everything else, including a
request with no identity. The service account's ClusterRole is read-only: get and
list on Argo CD Applications and Deployments, no wildcards, nothing else. The
delivered Services' Applications and workloads carry
`app.kubernetes.io/part-of=<service>`, the label the entity's selector uses.

## Consequences

- No apiserver change and no cluster recreate; `kore local up` converges as before.
- Kubernetes RBAC no longer tells operators apart: every operator Backstage
  admits sees the same Applications. Per-user cluster permissions are not
  provided; they return only if a cluster accepts the realm's tokens, which is a
  new decision.
- The service account holds a standing read grant, so the policy file and the
  ClusterRole are the two places to review when the view widens.
- A signed-in operator's Keycloak token is no longer sent to the Kubernetes API.
- The Backstage image changes (its config), so it needs a release, a new digest
  and a chart pin before a live run.
