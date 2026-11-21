---
status: accepted
summary: The local platform domain moves to kore.internal, the deprecated kore.local alias stays a bare Gateway listener, and the registry lock reference and the host resolver follow the domain as recorded here.
date: 2026-11-21
last-verified: 2026-11-21
---

# ADR 0175: The local domain is kore.internal and kore.local stays a deprecated alias

Source: [`docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md`](../../docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md)

Refines: 0132

## Context

ADR 0132 names the local services `<service>.platform.kore.internal`, with
`kore.internal` as the local default of the environment's platform domain and
`kore.local` kept as a deprecated alias until a contract step. The environment
still declared `kore.local`, so the flip the decision describes never ran: the
service names stayed under `platform.kore.local`, and the alias was not declared.
Owner decision of 2026-11-21: flip first, then retire the alias with the contract
step (#1217).

The flip is an expand step, so nothing is removed here. The lock file
`infra/catalog/images.lock.json` names `registry.kore.local:30500`, and the lock
changes only through a release, so the registry reference has to be decided
separately from the domain.

## Decision

- **The domain.** The local environment declares `platform.domain: kore.internal`
  and `platform.deprecatedAlias: kore.local`. The organization identifier stays
  `platform`. Service names are `<service>.platform.kore.internal`. The names
  under `platform.kore.local` stop at the flip by design: the local platform serves
  no service under that name after this change.
- **The alias is one listener.** `kore.local` is a bare HTTPS listener on the
  shared Gateway, with the same certificate as the domain, and nothing else. It is
  not a wildcard, no chart adds an alias hostname, and no route attaches to it, so
  a request to the alias name answers only through the listener. The contract step
  (#1217) removes the listener and the 8443 mapping.
- **Platform DNS serves one zone.** The platform DNS answers the primary zone,
  `kore.internal`. There is no alias zone and no chart change for the alias.
  `kore dns install` writes the resolver file for the primary zone,
  `/etc/resolver/kore.internal`.
- **The agents host routes both zones.** The agents role's platform DNS link
  routes `~platform.kore.internal` and keeps `~platform.kore.local` until the
  contract step, so the host resolves both names through the platform DNS. The
  host is changed only by the owner's Ansible apply. The apex names of each zone
  (`kore.internal`, `kore.local`) are outside the routed zone, as the apex
  `kore.local` was before; the live proof reaches the Gateway with `--resolve`.
- **The registry reference stays.** The lock reference stays
  `registry.kore.local:30500`. A lock reference is the release's name and does not
  follow `platform.domain`; only a release moves it, so the flip changes no lock
  entry and local builds never alter the release lock. Two names then coexist:
  - the **registry by name**, `registry.platform.kore.internal`, derived from the
    domain by the one registry-name derivation (ADR 0132's registry section), and
  - the **lock reference**, `registry.kore.local:30500`, which the release lock names.
    A local build is pushed to `registry.address` (ADR 0031), and its lock entry is
    the lock reference. Neither name is rewritten by the flip.
- **The Argo CD path carries the alias.** While `platform-argocd-delivery` is on,
  the Applications for `kore-platform-config` and `kore-local-tls` are the ones
  that serve the Gateway, so the delivery chart is handed `platformDeprecatedAlias`
  beside its domain and the Applications take `gateway.deprecatedAlias`, the same
  value the Helm path gives. Without it the alias listener would exist on the Helm
  path only.
- **Live proof.** The agentgateway live proof reaches the reference route at
  `https://kore.internal/` on port 443, which the `platform-dns` mapping publishes;
  the alias carries no route, so a request to `kore.local` would not answer 200.

## Consequences

- A live run on the new names follows the merge and the owner's Ansible apply of
  the agents role. The unit and integration tiers need no cluster or DNS.
- The expand step is #1395; the contract step that removes `kore.local` and 8443
  is #1217. Both are recorded on the pull request, not here.
- The flip changes every rendered name that derived from `platform.domain`
  (listeners, certificates, route hosts, the platform wildcard, the resolver file).
  The golden renders under `tools/kore/src/platform/fixtures` now carry the new name,
  and `platform-config-alias.local.yaml` is the render with the alias listener.
- ADRs 0132 and the earlier ADRs stay as history and are not edited.
