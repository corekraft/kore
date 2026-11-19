---
status: proposed
summary: The shared Gateway's listeners admit routes only from namespaces labelled platform.kore.dev/shared-gateway="true", which the platform charts and the delivery ApplicationSet set while platform-shared-gateway is on.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0134: The shared Gateway admits routes only from platform-labelled namespaces

Source: issue #1207, under #1194 (local names, shared Gateway).

Refines: [ADR 0133](0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md), which left the narrowing of allowed routes to a later step before the flag turns on.

## Context

A Gateway listener with `allowedRoutes.namespaces.from: All` admits a route from
any namespace. So a route in any namespace could claim a hostname the platform
holds, such as the platform organization's wildcard, and the Gateway would
attach it. ADR 0042's hostname-owner rule needs the Gateway to admit only the
namespaces the platform owns.

## Decision

- **The label.** A namespace the platform owns carries
  `platform.kore.dev/shared-gateway: "true"`. The key lives in the
  `platform.kore.dev/` prefix the platform already uses for its namespace
  labels, such as `platform.kore.dev/secret-source`.
- **The listeners.** While `platform-shared-gateway` is on, each HTTPS listener
  of the shared Gateway admits routes with `from: Selector`, matching that label.
  With the flag off the listeners keep `from: All`, so the rendered Gateway is
  unchanged.
- **Who sets it.** The platform chart `kore-platform-config` labels `kore-system`,
  where the Gateway lives. The golden-path ApplicationSet labels each app
  namespace it creates, through the sync's managed namespace metadata, while the
  flag is on. Both act only while the flag is on.
- **Other platform namespaces.** The registry, observability, Backstage, Keycloak
  and Argo CD namespaces need the label before any route of theirs attaches to
  the shared Gateway. That is not decided here: Helm's `--create-namespace`
  cannot set labels (ADR 0025), so who applies the label to each of them is an
  open question for the step that first attaches such a route.

## Consequences

- A route from a namespace without the label is not admitted by the shared
  Gateway. Today no HTTPRoute attaches to the shared Gateway: the golden-path and
  Backstage charts still use their own Gateways, so narrowing locks nothing out.
- The label is only as strong as the rights to set it. A right to patch
  namespace labels would let a workload admit itself, so the label is a
  preventive layer, not a boundary on its own. The hostname-owner constraint
  (#1194, slice 6) is the second layer and starts in audit mode.
- The label is a platform-owned key. It is not a tenant or organization label,
  so it does not change ADR 0038's rule for those labels.
