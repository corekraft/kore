---
status: proposed
summary: With otlp-route on, otlp.<organizationId>.<domain> reaches the collector's standard OTLP/HTTP receiver on 4318 through an HTTPS route on the shared Gateway, never the loopback-only 4319 receiver; the receiver has no authentication, so any host process can send telemetry through the entry point, which is accepted for the local platform only.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0140: OTLP is routed by name to the standard collector receiver behind otlp-route

Source: [GitHub issue #1224](https://github.com/corekraft/kore/issues/1224), under #1195 (services by name) and #1191; refines [ADR 0132](0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md), which names `otlp.` as one of the names behind the entry point and states the OTLP trade-off, and [ADR 0062](0062-telemetry-proofs-and-mesh-identity.md), whose loopback receiver stays unreachable from the network.

## Context

Host-side telemetry reaches the collector through a port forward to the
loopback-only receiver on 4319 (ADR 0062). That receiver exists because the
pod-IP receiver on 4318 refuses a forward. Once the shared Gateway serves
platform names on 443 (ADR 0132), OTLP can follow the registry and the databases
and be reached by name, replacing the forward for host callers.

The standard receiver on 4318 is the one a by-name route can reach. It is the
receiver every pod already uses, and it has no authentication. A route to it
therefore changes who can send telemetry, which ADR 0062's guarantee for 4319
does not cover. This ADR records that change and its trade-off.

## Decision

- **One route, to the standard receiver.** While `otlp-route` is on, a
  `kore-otlp-route` release (chart `infra/charts/otlp-route`, owner kore, phase
  configuration, namespace `observability`) renders one `HTTPRoute` named `otlp`.
  Its hostname is `otlp.<organizationId>.<domain>`, derived from the
  environment's platform field, and its only parent is the shared Gateway's
  `https-platform` listener, the platform wildcard's HTTPS listener with the
  platform certificate (ADR 0132). The Gateway terminates TLS; the backend is the
  collector's Service `otel-collector` on port `4318`.
- **HTTPS, not passthrough.** The client verifies the Gateway's certificate
  against the local CA, which `kore trust install` already trusts, and the
  collector's own certificate is not involved. The OTLP receiver never sees TLS.
- **The loopback receiver is never routed.** The route's backend is the 4318
  Service port only. The `otlp/loopback` receiver on `127.0.0.1:4319` (ADR 0062)
  is not a Service port, is not named by any route, and is unchanged in
  `infra/observability/collector/values.yaml`. Its "unreachable from the network"
  guarantee therefore holds.
- **No gRPC route.** Nothing on the host sends OTLP over gRPC: the host-side
  senders are HTTP. A gRPC route to 4317 is not added; it can follow the day a
  host-side gRPC sender exists, as its own decision.
- **Admission and flags.** The namespace carries the shared-Gateway label only
  while `otlp-route` is on, through the catalog's `sharedGatewayRouteFlag` (ADR
  0134). `otlp-route` needs `platform-shared-gateway`, which overlay validation
  checks before any mutation (ADR 0132). It is off in every overlay; turning it on
  needs a recorded live-run outcome for `otlp-route`, as for every flag.
- **Off renders nothing.** With the flag off the component is not installed, the
  chart renders no document, and the namespace is not labelled, so the flag-off
  install is unchanged.
- **Proof.** The live telemetry test posts through the name when the flag is on,
  verifying the Gateway against the local CA's public certificate, and through the
  4319 forward when it is off. The live run that proves the name is the shared
  names run; it is not part of this step.

## Exposure of the unauthenticated receiver

The standard receiver accepts OTLP from any caller and has no authentication, so
the route makes it reachable from the host through the entry point. This is the
trade-off ADR 0132 accepts; this section records what it is.

- **Who can reach it.** The entry point binds `127.0.0.1` only (ADR 0131, ADR
  0085), so no network host reaches it. Any process on the developer's host that
  can open a connection to loopback port 443 with the name
  `otlp.platform.kore.internal` can reach it. That includes other local
  processes, whatever their owner, and any sandboxed process with loopback access.
- **What a caller can do.** A caller can write traces, logs and metrics into
  Tempo, Loki and Prometheus under any resource attributes it chooses. It can
  thereby pollute the telemetry a developer reads, and it can produce series that
  match dashboards or alert rules. It can also send enough data to load the
  collector, whose limits are fixed (500m CPU, 768Mi memory); back-pressure then
  drops data from every sender, not only the caller's.
- **What a caller cannot do.** The route is write-only: the receiver has no read
  path, and Tempo, Loki, Prometheus and Grafana are not routed. The route reaches
  nothing but the collector's 4318 Service port; it cannot reach the API server,
  a secret, or another service. The 4319 receiver stays unreachable.
- **Why it is accepted.** The platform is local, the entry point is
  loopback-only, and every pod in the cluster can already send to the same
  receiver, so the route adds the host to a set of senders that already exists.
  Authentication for OTLP is out of scope here (ADR 0132), and no managed
  environment turns this flag on.
- **What is not accepted.** Turning `otlp-route` on in any environment whose
  Gateway is reachable from a network, or any change that binds the entry point
  beyond loopback, is outside this decision. Such an environment needs OTLP
  authentication on the route first, decided in a later ADR, and this ADR is then
  revisited.

This is the same posture ADR 0062 takes for mesh identity: a source that is
read from inside the platform and is not an application. It is not a substitute
for authentication, and nothing here claims the receiver is safe to expose.

## Consequences

- A developer who sends OTLP from the host can use the name instead of a port
  forward once the flag is on; the forward stays for the flag-off path.
- The route depends on the Gateway: it is applied after `kore-platform-config`,
  and its readiness check (`httproute/otlp`) waits until the controller reports
  every parent `Accepted` and `ResolvedRefs`, failing with the unmet condition
  rather than timing out. The end-to-end proof is the live run, as for every
  route.
- The collector's values are unchanged, so an existing cluster needs no
  recreate; k3d publishes no new host port, because the route uses the 443 entry
  point.
- Exposure review is recorded here, not re-derived per change: any new route to
  an unauthenticated receiver is read against this section.
