---
status: accepted
summary: Host senders reach OTLP only by name through otlp-route; the kubectl port-forward to the Collector is retired and no host caller starts one, and with otlp-route off the send is refused naming the flag, while the loopback receiver on 4319 stays in the Collector values.
date: 2026-11-21
last-verified: 2026-11-21
---

# ADR 0146: The OTLP port-forward is retired: host telemetry is sent by name

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 7](../../infra/plans/9-k3d-local-cluster.md#step-7-live-proof)

Refines: 0140, 0062

## Context

ADR 0140 routed OTLP by name behind `otlp-route`, and kept the host's port-forward to the loopback-only receiver on 4319 (ADR 0062) for the flag-off path. The names run of 2026-11-21 (#1225, comment 7054075779) proved the telemetry test three of three with `otlp-route` on: the name reached through the shared Gateway and verified against the local CA. `otlp-route` is now on in local (#1574). Nothing on the local path needs the forward any more.

## Decision

- **Host senders post by name.** The synthetic telemetry send (`sendSyntheticSignals`) posts the three signals to `https://otlp.<organization>.<domain>` through the shared Gateway, verified against the local CA's public certificate (ADR 0140). No host caller starts a `kubectl port-forward` to the Collector.
- **With `otlp-route` off, the send is refused.** It names the flag and the overlay to change, before any CA is read or any request is made, because nothing else reaches the Collector from the host. This narrows the flag-off path of ADR 0140, which no longer sends through a forward. No managed environment turns the flag on (ADR 0140, "What is not accepted"), so a managed environment's telemetry send is refused until a later decision turns it on there.
- **The loopback receiver stays.** The `otlp/loopback` receiver on `127.0.0.1:4319` (ADR 0062) remains in `infra/observability/collector/values.yaml`, unrouted and unreachable from the network. Removing it is a chart edit, which moves the content-addressed chart lock, so it is left for a later change. Nothing on the host sends to it.
- **No owner record.** The OTLP forward closed when its send ended and recorded no owner, so there is no forward for `platform stop` or `platform destroy` to end. Those commands keep ending the registry's forwards (ADR 0145).
- **ADRs 0062 and 0140 stay as history.** This ADR refines them; their descriptions of a forward on the flag-off path record the earlier decision.

## Consequences

- A host telemetry send needs `otlp-route` on in its environment's overlay. The local overlay has it on.
- The forward helper and its spec are gone; the telemetry live test posts by name and its header says so.
- Guides and specs describe the forward only as history.
