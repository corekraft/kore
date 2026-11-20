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

> Refined by [ADR 0136](0136-the-shared-gateway-serves-database-routes-on-a-loopback-5432-passthrough-listener-behind-database-routes.md): the 5432 passthrough listener, its Service port and its loopback mapping are rendered behind `database-routes`, with a per-environment opt-out.
>
> Refined by [ADR 0140](0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md): the OTLP name is an HTTPS route to the standard receiver on 4318 behind `otlp-route`, and its exposure is recorded there.

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

### The registry by name

Behind the flag `registry-by-name` (off in every overlay; issue 1219), host-side
digest lookup, cosign verification and pruning dial
`registry.platform.kore.internal` instead of the registry port-forward.

- **A passthrough route, not termination.** The shared Gateway gains a TLS
  passthrough listener (`tls-registry`) for the registry's name on the same port
  as its HTTPS listeners, and the registry chart owns one `TLSRoute` to its own
  proxy Service. The Gateway never terminates the registry's TLS, so the client
  verifies the registry's own certificate against its own CA, the proxy's basic
  authentication still decides who may read and who may write, and ADR 0058's
  end-to-end verification and ADR 0034's two accounts hold unchanged. A
  terminating route would add a re-encrypt hop and give up that verification, so
  it is not used.
- **One port.** The probe of issue 1218 (agentgateway v1.7.0, Gateway API 1.7.0)
  showed an HTTPS listener and a passthrough listener serve one port, told apart
  by the SNI name, so the registry keeps port 443 and its URL carries no port.
  The fallback of a separate loopback port is therefore not taken.
- **The certificate carries the name.** The registry's serving certificate gains
  the name as a DNS name beside the in-cluster address and `127.0.0.1`, so a
  verifying client succeeds. cert-manager reissues it on a flag change, but the
  proxy reads it at start, so an existing registry pod is restarted once; the
  host check names that command when it sees a certificate without the name.
- **Nodes are unchanged.** Nodes keep pulling from the registry's fixed
  in-cluster address (ADR 0031), which does not depend on DNS.
- **Admission and ownership.** The route attaches only to the shared Gateway and
  lives in the registry's namespace, which carries the shared-Gateway label
  (ADR 0134) only while this flag is on as well, through the catalog's
  `sharedGatewayRouteFlag`. The Gateway chart derives the registry's name from
  the platform wildcard it already takes, so the Helm path and the Argo CD
  Application agree.
  The flag needs `platform-shared-gateway`: overlay validation refuses it on
  without the shared Gateway, naming both flags. The hostname-ownership
  constraint (ADR 0042, `platform-hostname-ownership`) does not cover TLSRoute
  hostnames, so the registry's name is owned by this chart alone, not checked
  by that constraint.
- **Clear failures.** With the flag on, a name that does not resolve, a Gateway
  that refuses port 443, a certificate the registry's CA did not issue (no
  route), a dropped connection, and a certificate without the name each fail
  naming the cause and the fix, never a timeout. `kore doctor` runs the same
  check, as a warning, only while the flag is on.
- **The forward stays** until a contract ticket retires it, after one green live
  run by name. With the flag off every caller still uses it.

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

### The cutover record (issue #1215)

- **Everything new is dark.** The 443 mapping, the `https-alias` listener, the
  alias's certificate name and the activated domain take effect only while
  `platform-dns` is on. The checked-in local overlay keeps `platform.domain:
kore.local` and declares no alias, so with the flag off the Gateway, the
  certificate and the delivery values render byte-identically to main. The
  integration goldens are rendered from main's charts, and the flag-off spec
  compares against them. The feature is `feature-flagged` on `platform-dns`, off
  in every overlay.
- **The activation flips the domain and the flag together.** The owner-gated
  `platform-dns` activation PR sets `platform.domain` to `kore.internal`,
  declares `platform.deprecatedAlias: kore.local` and turns the flag on in
  local. Only then does an existing cluster change: the next `kore local up`
  applies the new listener hostnames and certificate names, and the 443 and
  1053 mappings cost one recreation (`kore local down --prune`, then
  `kore local up`), which the drift check names. That PR also checks the release
  lock's registry host: nodes pull from the domain-derived address, so the lock
  host follows the domain there, with its digests unchanged. Until then the
  lock keeps `registry.kore.local:30500`, which matches the checked-in domain.
- **443 follows the flag.** The loopback 443 mapping is declared with
  `featureFlag: platform-dns`, beside 1053, on the node port 8443 uses. Both
  mappings then cost one recreation, at the `platform-dns` activation. The gate
  is that flag and not `platform-shared-gateway`, which is on in local already:
  gating 443 on it would make the drift check refuse every existing cluster at
  once, and 1053 would then cost a second recreation. With the flag on, a
  cluster created before the change is refused, with
  `port 30443: 8443 != 443` and the recreate instruction; with the flag off it
  is not compared.
- **A privileged port is decided by lsof, never bound by kore.** Below 1024 only
  root may bind, so the pre-create check asks `lsof` and does not probe. A
  listener refuses the cluster, the message saying the port is privileged and
  naming the holder. A missing `lsof` also refuses (fail closed), the message
  saying that lsof was unavailable, so the cluster cannot be checked. No
  listener means free: Docker binds the mapping as root.
- **kore.local after the activation.** The platform DNS zone follows
  `platform.domain`, so once the domain is `kore.internal` it no longer answers
  `kore.local`. The deprecated alias is a listener, not a name the platform DNS
  serves; `kore.local` then resolves only through an older hosts entry.

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
