---
status: proposed
summary: external-dns becomes a pinned, mirrored platform component in its own namespace behind the external-dns flag, off in every overlay; it reads only routes of the external Gateway, filters to the platform domain and the one zone, excludes internal names, keeps a TXT registry, never deletes at first, targets the host's public IPv4 from run-time config and is proven in local with the inmemory provider before the domain exists.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0162: external-dns publishes route records for the external Gateway behind external-dns

Source: [#1483](https://github.com/corekraft/kore/issues/1483), decision 10 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478), and the answerer's reasoning on #1483 (2026-11-20)

Refines: [ADR 0042](0042-organization-domains-by-delegation.md) (ExternalDNS writes records inside delegated zones), [ADR 0077](0077-live-proof-gates-activation-not-merge.md) (a new dark flag)

## Context

ADR 0042 names ExternalDNS but nothing in the repository or the component catalog
installs it. Record 10 gives it the app records in the one Cloudflare zone, with a
TXT registry and a domain filter, and record naming says `internal.` names never
go to public DNS. Upstream, the Cloudflare provider needs Zone Read and DNS Edit,
and a token limited to one zone needs `--zone-id-filter`, or the provider lists
every zone. The provider `inmemory` needs no credentials; `--policy` is one of
`sync`, `upsert-only` and `create-only`.

The host firewall (ADR 0141, `table inet kore_host`) drops all inbound traffic
but the tailnet, so public 443 is closed; opening it is concept 4's change.

## Decision

- **A new catalog component behind the flag `external-dns`.** The chart is
  pinned, the image is pinned by digest and copied through the signed mirror
  ([ADR 0044](0044-managed-platform-images-from-the-mirror.md)). The flag is off
  in every overlay and counts toward the vps "all on" set. It requires the
  external Gateway flag (name from concept 4), so it cannot be activated while
  public 443 is closed.
- **Its own namespace, `kore-external-dns`.** Not `kore-dns`, which is exempt from
  image enrollment. It is enrolled in image admission like other platform
  namespaces.
- **Scope.** Provider `cloudflare`; source `gateway-httproute`; routes of the
  external Gateway only (`gateway-label-filter`; its exact shape waits for
  concept 4's Gateways); `domain-filter` is the platform domain;
  `exclude-domains` is `internal.<domain>`; `zone-id-filter` is the one zone;
  the TXT registry owner id is `kore-vps`; proxy is off, stated explicitly;
  record type is A only. An internal name therefore cannot reach Cloudflare
  through external-dns even from a mislabelled route.
- **The target is a run-time value.** The host's public IPv4 address, never in
  the repository. Whether the Gateway's status address or `--default-targets`
  carries it is proven in local before the vps run (unverified upstream).
- **Never deletes at first.** The first activation runs `upsert-only`. A later,
  separately flagged change flips to `sync` after a live run shows a foreign
  record is left alone and a removed route leaves its record until the flip.
  Deleting a public name is the destructive act, so it waits for its own outcome.
- **The token is a Secret per namespace.** `cloudflare-token` in
  `kore-external-dns`, never in git, applied by kore through stdin; it is separate
  from cert-manager's. The record is a 300-second TTL, reconciled every 5 minutes.
- **Provider is an overlay value.** Local runs external-dns with the `inmemory`
  provider (no credentials, no network), chosen by the local overlay as a chart
  value ([ADR 0012](0012-environment-overlays-hold-provider-specifics.md)); vps
  chooses `cloudflare`.
- **Failure is an infrastructure event.** If Cloudflare is unreachable, the token
  is revoked or external-dns is down, existing records persist at Cloudflare and
  running apps are unaffected; new hostnames wait and retry. Hostname-claim
  admission does not depend on DNS being live. Notify-only alerts fire on
  external-dns sync errors. The platform readiness check lists external-dns only
  while the flag is on.

## Proof before the domain

The `inmemory` provider has no read API, so the local k3d proof asserts the
planned changes and ownership TXT lines from external-dns's own info log, read
from the pinned version, and shows the domain filter and the internal exclusion by
the absence of changes for filtered names. The real read-back from Cloudflare (an
API list or `dig`) is part of the vps proof. The names in the proof are
`example.com`-style test names. Everything Cloudflare-specific waits for the
domain.

## Consequences

- The flag cannot turn on in vps before the domain is bought, the external Gateway
  flag is on and the owner-made token exists, so v1 "all on" is blocked on the
  domain purchase.
- Image enrollment and mirror entries for a new image are part of the change.

## Decided by the owner

On 2026-11-20 the owner accepted every recommendation of the DNS grilling,
including two separate tokens and tokens kept outside the OpenBao-backed store
(see the zone-ownership decision). The delete policy beyond `upsert-only` is a
recommendation the owner may change.
