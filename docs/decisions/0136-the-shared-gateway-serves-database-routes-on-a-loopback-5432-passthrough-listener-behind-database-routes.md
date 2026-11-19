---
status: proposed
summary: With database-routes on, the shared Gateway gains a TLS passthrough listener, its Service a second port and node port, and the overlay a loopback 5432 mapping that an environment can opt out of; off, nothing renders.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0136: The shared Gateway serves database routes on a loopback 5432 passthrough listener behind database-routes

Source: [GitHub issue #1220](https://github.com/corekraft/kore/issues/1220), under #1195 (databases by name); the plan is [`infra/plans/15-next-horizon.md` § Step 5](../../infra/plans/15-next-horizon.md#step-5-platform-argo-cd-delivery-from-git).

Refines: [ADR 0132](0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md), which names port 5432 as the database entry point and leaves how its mapping and listener are declared to this step.

## Context

Databases are to be reached as `<database>.platform.kore.internal` on host port
5432, through a TLS passthrough listener, so the database keeps its own
certificate. The listener, a Service port and a loopback mapping have to agree,
and a developer with a native Postgres on 5432 must not be blocked from the
rest of the platform. k3d fixes its port mappings when it creates the cluster,
so the mapping cannot follow a flag at runtime.

## Decision

- **One flag, three renders.** While `database-routes` is on,
  `kore-platform-config` renders a `postgres` listener on the Gateway (port
  5432, protocol `TLS`, mode `Passthrough`, the platform organization's
  wildcard as hostname, routes admitted by the same selector as the HTTPS
  listeners), and, when the overlay sets `gateway.database.nodePort`, a second
  port on the Gateway Service with that node port, in the Istio ConfigMap and
  the `AgentgatewayParameters` alike. Off, none of the three renders and the
  rendered chart is byte-identical to the one before the flag existed. The
  listener is on its own port, so it never shares one with the HTTPS listeners,
  whatever the agentgateway mixed-listener probe shows.
- **Every port is named.** The Service port is named `postgres`, the listener's
  name, so Istio's generated port and the overlay entry are one; agentgateway
  generates `listener-5432` and the overlay entry renames it in place. The
  Service keeps every port named and unique.
- **The mapping is declared in the overlay and follows the flag.** The local
  overlay's `k3d.ports` lists `127.0.0.1:5432` to load balancer port 30432 with
  `featureFlag: database-routes`, the node port the overlay's chart values set.
  While the flag is off the mapping is not created, compared by the drift check
  or probed (ADR 0132), so an existing cluster and a host using 5432 behave as
  before. The first activation on a cluster created without the mapping needs
  one recreate (`kore local down --prune`, then `kore local up`), and the drift
  check then names the unmapped port.
- **The opt-out is a field on the mapping.** A port entry may set
  `optOut: true`. An opted-out mapping is not created, compared or probed even
  with the flag on, so the host port check skips 5432 and a developer with a
  native Postgres still runs `kore local up`. The listener and the Service
  port stay rendered (they are cluster-internal without the mapping), and the
  databases stay reachable in the cluster.
- **The flag stays off.** `database-routes` is false in every overlay; it is
  turned on only after a recorded live-run outcome for it.

## Consequences

- Namespaces holding a database route need the shared-gateway label (ADR 0134)
  before their TLSRoute attaches to the `postgres` listener; the route and its
  certificate come with the PostgreSQL composition, a later step.
- A developer who opts out gives up reaching databases by name from the host
  and keeps the by-hand port forward.
- The overlay declares the node port twice, in `k3d.ports` and in the chart
  values, as it already does for 8443; the Gateway Service agreement
  integration spec fails when they differ.
