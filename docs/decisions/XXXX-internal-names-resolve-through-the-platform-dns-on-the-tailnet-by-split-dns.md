---
status: proposed
summary: On vps the platform DNS answers the internal zone on UDP and TCP 53 on the tailnet address only, with its answer address read from a host-written ConfigMap instead of a committed value, and Tailscale split DNS sends the internal zone to it through one documented owner step that a preflight checks.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: Internal names resolve through the platform DNS on the tailnet by split DNS

Source: [issue #1482](https://github.com/corekraft/kore/issues/1482), under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478) (decision 5 and the naming section).

Refines: [ADR 0132](0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md) (the platform DNS is local-only and answers the loopback address) and [ADR 0135](0135-pods-resolve-platform-names-through-the-bundled-dns-and-trust-the-local-ca-from-a-configmap.md) (its chart's answer).

## Context

The record names `<service>.<suborg>.internal.<domain>` for the tailnet and says `internal.` names never reach public DNS: Tailscale split DNS points that zone at the platform DNS. The `platform-dns` chart answers one fixed address for the whole zone on port 1053, and local answers `127.0.0.1`. On vps the answer must be the node's tailnet address, which the public repository must not hold. Tailscale split DNS takes a nameserver IP and documents no port, so port 53 is assumed. The tailnet-wide DNS setting lives in the Tailscale admin console, outside the repository, and a wrong entry breaks the owner's name resolution on every device.

## Decision

- **Published on the tailnet address only.** The platform DNS answers UDP and TCP 53 on the tailnet address, through a node port plus the same Ansible mapping as the Gateways (ADR XXXX, two Gateways). It is never reachable on another interface.
- **The answer address comes from the host.** The chart reads it from the `kore-host-addresses` ConfigMap that Ansible writes as a k3s auto-deploy manifest, so the host that knows its own tailnet address is its only owner. `platform-dns` for vps validates that the ConfigMap exists before any mutation.
- **One owner step in the Tailscale console,** written in `infra/hosts/vps/README.md`: a restricted nameserver for the internal zone, pointed at the node. It is a one-time step, not automated in v1, because it is tailnet-wide.
- **A preflight checks it.** `kore platform up` resolves one internal name from the controller over the tailnet and, on failure, fails naming the console step.
- **One replica.** A platform DNS outage ends internal name resolution on the tailnet until it restarts. This is accepted for one node, and the platform DNS has platform priority.
- **Names outside the zone are not answered.** The zone answers only the internal zone and never forwards, as the chart does today.

## Consequences

- `platform-dns` applies to vps; ADR 0132's "Platform DNS is local-only" no longer holds.
- Pre-domain, the zone is `kore.internal`; after the domain exists it is `internal.<domain>` and the console entry changes once, before any app exists.
- A device off the tailnet resolves nothing under the internal zone, because public DNS has no such record.
- The controller and the agents VM resolve internal names only while Tailscale's DNS settings are accepted on them.
