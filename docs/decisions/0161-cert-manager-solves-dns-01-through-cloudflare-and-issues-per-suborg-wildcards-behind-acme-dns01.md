---
status: proposed
summary: Behind the flag acme-dns01, vps only, cert-manager gets a Let's Encrypt staging and a production ClusterIssuer that solve DNS-01 through Cloudflare for the platform zone, with the DNS-01 self-check pointed at public resolvers so the in-cluster rewrite cannot hide the challenge; platform names get per-suborg wildcard certificates, foreign names get HTTP-01 per-name certificates, and the first live proof uses staging then production under one outcome.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0161: cert-manager solves DNS-01 through Cloudflare and issues per-suborg wildcards behind acme-dns01

Source: [#1483](https://github.com/corekraft/kore/issues/1483), decisions 5, 9 and 10 and the naming section of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478), and the answerer's reasoning on #1483 (2026-11-20)

Refines: [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md) (no ACME issuer is used), [ADR 0135](0135-pods-resolve-platform-names-through-the-bundled-dns-and-trust-the-local-ca-from-a-configmap.md) (the zone rewrite), [ADR 0077](0077-live-proof-gates-activation-not-merge.md) (a new dark flag)

## Context

ADR 0142 gives vps an in-cluster CA and no ACME issuer, because the cluster had no
public ingress. Record 5 revises that: the external Gateway has public 443, a real
domain and ACME. Record 9 and the naming section choose DNS-01 certificates, a
wildcard per suborg for internal names, and an ACME proof for a name under another
domain.

Two facts bear on the design. First, ADR 0135's `coredns-custom` rewrite sends
every name under the platform zone, in any query type, to the Gateway Service, so
cert-manager's DNS-01 self-check for `_acme-challenge.<name>` would be rewritten
and never see the TXT record: the order would hang. Second, Let's Encrypt allows 50
new certificates per registered domain per 7 days, with no override
(`letsencrypt.org/docs/rate-limits`), and a new suborg is an agent sandbox created
without approval (#1484).

## Decision

- **A flag, `acme-dns01`, vps only.** It needs a real zone, so no other overlay
  turns it on. It is off in every overlay and counts toward the vps "all on" set.
  With it on, kore passes the platform-certificate chart the real domain and the
  zone's Cloudflare solver; with it off nothing renders.
- **Two ClusterIssuers, staging and production.** One ACME issuer per directory,
  both solving DNS-01 for the platform zone through Cloudflare, selecting by
  `dnsZones` so they never handle another domain. The token is a Secret named
  `cloudflare-token` in `cert-manager`, never in git, applied through stdin, and
  separate from external-dns's. No ACME account email is configured or committed;
  if the owner wants expiry mail it arrives as a run-time variable.
- **The self-check bypasses cluster DNS.** The flag also sets cert-manager's DNS-01
  recursive nameservers to pinned public resolvers, with recursive-nameservers-only,
  in the chart values, so the rewrite stays and in-cluster callers keep reaching
  the Gateway by name. The live proof asserts both a Ready certificate and a pod
  lookup of the same name still returning the Gateway.
- **Certificate shape.** A name under the platform domain is served by a per-suborg
  wildcard (`*.<suborg>.<domain>`, DNS-01), so one issuance per suborg keeps the
  platform far under the cap and service names stay out of certificate
  transparency. Internal names use the per-suborg internal wildcard under the same
  issuer. A foreign name gets one certificate per name by HTTP-01, because
  Kore never holds a credential for a zone it does not control; HTTP-01 needs port
  80 on the external Gateway, which is concept 4's firewall and listener change.
  Concept 4 owns the listeners; this decision states the issuance consequence.
- **What becomes public.** DNS-01 for the internal wildcard writes
  `_acme-challenge.<suborg>.internal.<domain>` TXT records into the public zone and
  certificate transparency lists `*.<suborg>.internal.<domain>`. So the rule is
  worded: no internal address or service name reaches public DNS. Suborg names do
  (the owner accepted this).
- **CAA and the issuer agree.** OpenTofu's CAA names the same CA, and gains the
  account binding after the first ACME account exists.
- **Order of the first live run.** Staging proves the internal suborg wildcard, the
  production issuer is added only after staging is Ready, and the one flag outcome
  records both. The in-cluster CA keeps its role for the registry and other
  non-public names (concept 4 settles the rest).
- **Issuance budget (#1679).** The platform chart renders, for each suborg in the
  Organization records, two Certificates: `*.<suborg>.<domain>` and
  `*.<suborg>.internal.<domain>`. Both reference `acmeDns01.certificateIssuer`, which
  is `letsencrypt-staging` until a staging Ready outcome is recorded, and no
  Certificate references production before then. Each new suborg is therefore two new
  certificates. Let's Encrypt allows 50 new certificates per registered domain per 7
  days, and every pair of the platform domain counts against that one domain, so the
  budget is 25 new suborgs per 7 days (2 issuances each, 50 in all). Renewals of an
  existing pair are not new certificates under that limit. A suborg with no
  Organization record has no name, so it costs nothing.
- **Failure is an infrastructure event.** A revoked token or an unreachable
  Cloudflare stops new issuance and renewals; running certificates keep serving, and
  renewal starts 30 days before expiry. Notify-only alerts fire on a certificate not
  Ready or under 14 days to expiry. The readiness check lists the issuer only while
  the flag is on.

## Proof before the domain

None of this is provable without a zone. Pre-domain, only the chart's render and
the overlay validation are tested. Token scope, record writes and DNS-01 against
Let's Encrypt staging are proven after the domain exists.

## Consequences

- cert-manager's values gain DNS-01 settings under the flag, which changes the
  pod template once when the flag turns on.
- The flag needs the external Gateway for production use but the staging proof of
  the internal wildcard does not.

## Decided by the owner

On 2026-11-20 the owner accepted every recommendation:

- The CA is Let's Encrypt, staging first, named in CAA and in the issuers.
- Suborg names may appear publicly (the ACME TXT record and certificate
  transparency list `*.<suborg>.internal.<domain>`); no internal address or
  service name reaches public DNS.
- A full foreign hostname may appear in a public app record, so a foreign name
  is served with an HTTP-01 certificate of its own.

Still open, and concept 4's: if port 80 is refused, the fallback for a foreign
name is the foreign owner CNAME-delegating `_acme-challenge` to the platform
zone.
