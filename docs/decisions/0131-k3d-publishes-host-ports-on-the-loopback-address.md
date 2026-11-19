---
status: accepted
summary: Every host port the k3d load balancer publishes binds a loopback IPv4 address the overlay declares, and the drift check compares the host address as well as the host port, so a cluster published on every interface is refused with the recreate instruction.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0131: k3d publishes host ports on the loopback address

Source: [GitHub issue #1197](https://github.com/corekraft/kore/issues/1197), under #1193.

Refines: [ADR 0085](0085-k3d-gateway-answers-through-a-node-port.md).

## Context

ADR 0085 maps the Gateway's host port through the k3d load balancer. The
`k3d cluster create --port` argument named the host port but no host address,
so Docker bound it on every interface, and the Gateway answered on the LAN as
well as on the host. The drift check compared only host port numbers and
dropped the host address Docker reports, so a cluster already published on
every interface matched the overlay and was never refused.

## Decision

- Each entry of `environment.k3d.ports` carries a `hostAddress`: the loopback
  IPv4 address its host port binds, in 127.0.0.0/8. The local overlay sets
  `127.0.0.1`. Schema and config validation refuse a missing or malformed
  address, or one outside loopback, before any cluster command runs.
- The create arguments are built in one place and emit the declared address
  for every published port, as `<hostAddress>:<hostPort>:<loadBalancerPort>@loadbalancer`.
- The drift check compares the host address as well as the host port of each
  declared port. A port published on the right host port at another address is
  refused, naming the address, with the existing recreate instruction:
  `port 443 address: 0.0.0.0 != 127.0.0.1`. A listing that omits the host
  address reads as `unreported` and is refused the same way.
- A cluster created before this change binds every interface, so it fails
  drift. The owner recreates it with `kore local down --prune`, then
  `kore local up`. There is no in-place migration.

This refines ADR 0085 only on the host side of the mapping. The node port, the
load balancer mapping and the Gateway Service are unchanged.

## Consequences

- The local Gateway answers only from this machine. Nothing on the network can
  reach the host port.
- A local profile created before this change must be recreated once. The
  refusal names the address and the remedy, so it is not a silent failure.
- Each new published port needs a declared loopback address. An overlay that
  omits one fails validation before the cluster is touched.
