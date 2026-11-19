---
status: proposed
summary: Local services are reached as <service>.platform.kore.internal through a platform DNS in the cluster, a host resolver file that kore local up installs, and one loopback entry point on port 443, with kore.local and 8443 kept as deprecated aliases.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0132: Local names resolve through platform DNS and one loopback entry point

Source: [`docs/vision.md` § Domains and Hosts](../vision.md#domains-and-hosts)

Refines: [ADR 0013](0013-local-tls-before-gateway.md),
[ADR 0042](0042-organization-domains-by-delegation.md),
[ADR 0083](0083-k3d-publishes-through-the-node-containerd-client.md)
and [ADR 0085](0085-k3d-gateway-answers-through-a-node-port.md).

## Context

A developer reaches local services at `https://kore.local:8443/` through a
hand-edited hosts entry. A hosts file cannot hold a wildcard, `.local` is
reserved for Bonjour on macOS, and every address carries a port. Each service
chart creates its own Gateway, which the host cannot reach because only the
platform Gateway's node port is mapped. Pods cannot resolve any platform name
and do not trust the local certificate authority, so an in-cluster call to a
platform name, such as a Backstage sign-in against Keycloak, cannot work. The
registry, the databases and the telemetry receiver are reached through three
separate port forwards.

ADR 0042 names the local platform domain `kore.local`, requires the platform
domain to be a separate registrable domain from any organization's, and leaves
the choice open. ADR 0013 puts the one host trust change, `kore trust install`,
in an explicit command. ADR 0085 fixes the Gateway on host port 8443.

## Decision

- **Names.** A local service is `<service>.platform.kore.internal`. The
  organization identifier stays `platform`, so the Organization resource and
  the Service enum are unchanged. `kore.internal` is the local default of the
  environment's platform domain; it is one environment field, so a domain
  bought later replaces it there and nowhere else.
- **Platform DNS.** A pinned, local-only DNS server in the cluster answers the
  zone with the loopback address (and empty answers for IPv6). The cluster
  publishes it on a loopback port that is neither the mDNS port nor a
  privileged port, over UDP and TCP. In the cluster, the bundled DNS rewrites
  the zone to the Gateway Service's DNS name, and pods trust the local CA, so a
  pod and the host call the same names.
- **Host resolver.** A resolver file for the zone points the host at that DNS.
  `kore dns install` and `kore dns uninstall` are their own commands because
  they are the only part that needs administrator rights; they write and remove
  only a file carrying a Kore marker. `kore local up` runs the install when
  the file is missing or its content differs from what the environment expects,
  with the standard password prompt, and skips it, leaving `kore doctor` to
  report it, when there is no terminal. This is a second trust-changing host
  operation beside `kore trust install`, and `kore doctor` reports both.
- **One entry point.** The k3d load balancer publishes host port 443 on the
  loopback address, ADR 0131's binding, beside 8443. One shared platform
  Gateway carries a wildcard HTTPS listener whose certificate comes from the
  local CA that `kore trust install` already trusts. The platform owns the
  Gateway, its listeners and its certificate; service charts own routes only.
- **Deprecated aliases.** `kore.local` stays a listener hostname and 8443 stays
  mapped until a contract ticket removes them with the next planned recreation
  of the local cluster. Nothing else may be added under either.
- **Beyond the web names.** The registry, the databases and the telemetry
  receiver are reached by name through the same entry point
  (`registry.`, `otlp.` and `<database>.platform.kore.internal`), each behind
  its own flag, replacing their port forwards. The registry keeps its own
  certificate, authentication and ADR 0058's end-to-end verification through a
  passthrough route.
- **OTLP trade-off.** The OTLP route reaches the standard receiver, not the
  loopback-only receiver [ADR 0062](0062-telemetry-proofs-and-mesh-identity.md)
  added, whose "unreachable from the network"
  guarantee therefore holds. The receiver has no authentication, so once the
  route exists any process on the host can send telemetry through the entry
  point. That is accepted because the entry point binds only the loopback
  address and the receiver is already reachable by every pod in the cluster.
  Authentication for OTLP is out of scope.

- **The DNS mapping follows the flag.** The local overlay declares loopback
  port 1053 over TCP and UDP (load balancer port 31053, the node port of the
  `kore-platform-dns` Service) in `k3d.ports`, each entry carrying
  `featureFlag: platform-dns`. While the flag is off the mapping is not
  created, not compared by the drift check and not probed, so an existing
  cluster, and a host already using loopback 1053, behave as before. k3d fixes
  ports when it creates the cluster, so the first activation of `platform-dns`
  on a cluster created without the mapping needs one recreate
  (`kore local down --prune`, then `kore local up`); the drift check then names
  the unmapped port. The `kore-dns` namespace is in `enrollmentExemptions` with
  a reason, so image enrollment never makes name resolution wait on the
  verifier.

### Why the earlier decisions change

- **ADR 0042: the separateness rule holds for the domain chosen.**
  `kore.internal` is a private-use name that no organization owns and no
  public registrant can answer, so the platform domain is still separate from
  every organization's. `kore.local` was never a registrable domain; the
  decision to move off it is the need for a wildcard and an unreserved suffix.
  The rule that the platform owns `<org-id>.kore.internal` only is unchanged.
- **ADR 0013: a second host change.** Names cannot work without the resolver
  file, and a developer who must remember a second command will not. Running
  the install from `kore local up` keeps the change explicit by showing the
  one file and prompting before elevated rights, and the standalone commands
  remain.
- **ADR 0083: the registry by name.** A name through the entry point replaces
  the registry forward for host callers; the node's containerd push path is
  unchanged. This ADR records the direction; the registry ticket (#1195) owns
  the change.
- **ADR 0085: ports.** The node port and the load balancer mapping are
  unchanged; 443 and the DNS port are added, and the drift check compares them
  like the existing ones. This does not contradict ADR 0131: every published
  port, new ones included, binds a loopback address the overlay declares.

## Consequences

- One recreate of the local cluster (`kore local down --prune`, then
  `kore local up`) is needed, to publish 443 and the DNS port. The existing
  drift refusal names the differing ports and the remedy.
- `kore local up` can prompt for a password. A non-interactive run finishes the
  cluster and leaves the missing resolver file to `kore doctor`.
- Hosts, `/etc/hosts` edits and the port in a URL disappear from the README and
  the troubleshooting guide. Specs, scripts and charts that hard-code
  `kore.local` migrate in batches behind the one environment field.
- Platform DNS is local-only; managed environments keep ExternalDNS (ADR 0042).
- Any process on the host can send unauthenticated telemetry to the local
  receiver through the entry point.
- A name-constrained local CA, per-organization listener sets and managed DNS
  are not decided here.
