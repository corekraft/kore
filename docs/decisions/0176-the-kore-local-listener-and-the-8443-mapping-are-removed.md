---
status: accepted
summary: The kore.local listener and the 8443 host mapping are removed at the contract step; the host reaches the platform Gateway on 443 through one constant, and the in-cluster listener port stays.
date: 2026-11-21
last-verified: 2026-11-21
---

# ADR 0176: The kore.local listener and the 8443 mapping are removed

Source: [`docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md`](../../docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md)

Refines: 0132, and completes the contract step that ADR 0175 left open

## Context

ADR 0132 kept `kore.local` and the host port 8443 as deprecated aliases until a
contract step. ADR 0175 flipped the local domain to `kore.internal` with
`kore.local` as a bare listener, the expand step (#1684). That step's live proof
is recorded on #1686 (comment 7058084451), and the 8443 migration from a
pre-cutover profile on #1216 (comment 7056491301).

Keeping both names and both host mappings means every probe, every readiness
check and every doc has two entry points to choose between, and the alias
listener exists only to serve a name nothing else uses. The host already reaches
the platform Gateway on 443 through the `platform-dns` mapping, which ADR 0132
made the one loopback entry point.

## Decision

- **The overlay names one domain.** The local environment declares
  `platform.domain: kore.internal` and no deprecated alias. The field
  `platform.deprecatedAlias` is removed from the environment schema and from the
  chart values. An overlay that still declares it fails validation, naming the
  field and the fix, so a stale alias is refused rather than ignored.
- **No chart renders the alias.** The Gateway's listeners are the domain's HTTPS
  listener, the database and registry passthrough listeners and, behind their
  flags, the shared wildcard, as before. No listener or certificate name is
  rendered for `kore.local`, on the Helm path or the Argo CD path.
- **The 8443 mapping is removed.** The k3d `ports` entry that publishes host port
  8443 is removed. The host entry point is port 443, published by the
  `platform-dns` mapping (ADR 0132). `gateway.port` (8443) stays the in-cluster
  listener port: no host reaches it, and the Service maps it to the node port.
- **One constant names the entry point.** `gatewayEntryPort` (443) is the host
  port a probe or readiness check reaches the Gateway on. Readiness finds the node
  port from the mapping at that port, and the identity probe calls the Gateway
  there, so neither reads the in-cluster listener port as a host port.
- **The drift check refuses the old mapping.** A cluster that publishes 8443 and
  no 443 is refused against the overlay, naming the port the overlay expects. A
  cluster that publishes 443 with a leftover 8443 is not a difference: extra
  mappings are not refused, and only a recreated profile drops the old one.
- **Not changed.** `infra/catalog/images.lock.json` keeps `registry.kore.local:30500`:
  the lock changes only through a release (ADR 0175), so the registry reference
  is decided separately from the domain. ADRs 0132 and 0175 and the earlier ones
  stay as history and are not edited. `infra/plans`, `CHANGELOG.md` and the
  records under `docs/ideas` stay as they were.

## Consequences

- The contract step is #1217; its expand step is #1684, and its proof is recorded
  there, so nothing is turned on or off here.
- The agents VM's `kore-dns` link stops routing `platform.kore.local`: the
  owner's Ansible apply of the agents role makes that change on the host.
- A profile created before this change still publishes 8443 until it is
  recreated; `kore local down --prune` then `kore local up` converges it. A live
  run on a recreated profile follows the merge; this change does not claim it.
- With `platform-dns` off the local overlay publishes no host entry point at
  all, because the only other mapping was the removed 8443. `platform-dns` is on
  in `local` (#1682), so the local host entry point is unchanged for every
  profile this repository renders by default.
