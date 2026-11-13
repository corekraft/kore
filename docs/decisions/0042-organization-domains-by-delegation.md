---
status: proposed
summary: Organizations bring domains by delegating a zone under any TLD to the platform's DNS, services are subdomains within those zones, and every organization also gets one default zone under a per-environment platform domain.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0042: Bring organization domains by delegation, with one platform default zone each

Source: [`docs/vision.md` § Domains and Hosts](../vision.md#domains-and-hosts)

Refines: [ADR 0012](0012-environment-overlays-hold-provider-specifics.md), which
gains a per-environment platform domain and DNS provider.

## Context

Services are subdomains of their organization's domain, such as
`auth.apps.corekraft.ca`. Companies under one umbrella often use unrelated
domains, so a sub-organization cannot be limited to its parent's domain. The
options were proving ownership with TXT records and leaving DNS to each
organization, or having organizations delegate a zone to the platform's DNS so
the platform writes records itself. Organizations that have not added a domain
still need working hosts.

## Decision

- **Domains come by delegation.** An organization delegates a zone, either a
  whole domain such as `corekraft.ca` or a subdomain such as
  `apps.corekraft.ca`, to the platform's DNS with NS records. A working
  delegation is the proof of control; there is no TXT path.
- **Any organization, any TLD.** An organization at any level may delegate
  zones under any TLD, such as `corekraft.ca` for one company and
  `acme-freight.eu` for another. A parent may restrict which domains its
  subtree may use; it does not require them to sit under its own.
- **Services are subdomains of a delegated zone.** Each organization names a
  service base inside one of its zones, and a service gets `<service>.<base>`
  by default. Other hosts are allowed only inside the organization's own
  zones.
- **One owner per hostname.** A Gatekeeper constraint rejects any route whose
  host is outside the owning organization's zones or already owned by another
  service, starting in audit mode
  ([ADR 0017](0017-gatekeeper-policy-families-audit-first.md)).
- **The `Organization` API checks delegation** through a Crossplane function,
  as the PostgreSQL API composes today. ExternalDNS writes records inside
  delegated zones, and cert-manager issues certificates for them, including
  DNS-01 wildcards.
- **A lapsed delegation has a grace period.** No new routes are admitted, the
  organization is alerted, existing hosts keep serving for seven days, and
  then their routes are removed.
- **Every organization gets one default zone.** The zone is the organization's
  identifier under the platform domain, so a service is reachable at
  `<service>.<organization>.<platform domain>` before any domain is delegated.
  The platform domain is a per-environment setting, a separate registrable
  domain from any organization's, and is still to be chosen; locally it is
  `kore.local`. It is submitted to the Public Suffix List before outside
  tenants are admitted.

## Consequences

- Organization identifiers must be unique across the platform, because each
  one names a default zone.
- Each environment names its platform domain and DNS provider in its overlay.
- Every new service gets DNS and a certificate without a manual DNS change by
  the organization.
- Serving a domain's apex requires delegating the whole domain, not just a
  subdomain.
- Hosts outside a delegated zone are unsupported; adding them later, for
  example by TXT verification, needs a new ADR.
