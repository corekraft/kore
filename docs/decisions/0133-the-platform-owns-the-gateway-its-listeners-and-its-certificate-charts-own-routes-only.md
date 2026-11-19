---
status: proposed
summary: The platform owns the shared Gateway in kore-system, its listeners and its wildcard certificate; a service chart owns only its routes, and keeps its own Gateway only until its routes move onto the platform Gateway.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0133: The platform owns the Gateway, its listeners and its certificate; charts own routes only

Source: [`infra/plans/15-next-horizon.md` § Step 5](../../infra/plans/15-next-horizon.md#step-5-platform-argo-cd-delivery-from-git)

Refines: [ADR 0085](0085-k3d-gateway-answers-through-a-node-port.md).

## Context

The golden-path and Backstage charts each say the platform Gateway in
`kore-system` "is not touched, so it keeps one owner". That wording predates
the shared platform Gateway that [ADR 0132](0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md)
puts behind `*.platform.<domain>`. The shared Gateway needs one owner for its
listeners and its certificate, and the service charts need to attach routes to
it without creating a Gateway each.

[ADR 0085](0085-k3d-gateway-answers-through-a-node-port.md) fixes the Gateway's
Service port and node port in the platform chart's overlay, and the platform
chart already owns the Gateway resource. Nothing yet says who owns the listeners
added to it or its wildcard certificate.

## Decision

- **The platform owns the Gateway.** The platform chart in `kore-system` owns the
  Gateway resource, each of its listeners (their hostnames, ports and TLS), and
  the certificates those listeners serve. A service chart may not change them.
- **Charts own routes.** A service chart owns its HTTPRoutes and attaches them
  to a platform listener. Until its routes move onto the platform Gateway, a
  service chart keeps its own Gateway; that Gateway is the one the next expand
  step removes, not a second owner of the platform's listeners.
- **The wildcard is a listener.** A Gateway listener holds one hostname, so the
  platform organization's wildcard is a second HTTPS listener on the Gateway's
  existing port, with its own certificate from the local CA. The `kore.local`
  listener is unchanged.
- **The Service keeps the listener's port.** Where the overlay publishes the
  Gateway as a NodePort, the flag `platform-shared-gateway` exposes the standard
  port 443 on the Service and reaches the unchanged listener through its
  `targetPort`. The node port is unchanged, so the load balancer's existing
  mapping still reaches the Gateway.

This replaces the "not touched, so it keeps one owner" wording in the
golden-path and Backstage charts' comments.

## Consequences

- A change to a Gateway listener, to its Service or to its certificate is a
  platform change, reviewed as one. A service chart's pull request touches only
  its routes.
- The shared Gateway's listeners are dark until `platform-shared-gateway` is
  turned on. With the flag off the rendered Gateway and Service are unchanged.
- Narrowing the shared listener to platform-labelled namespaces is not decided
  here; it is a later step, before the flag turns on. ADR 0134 decides it.
