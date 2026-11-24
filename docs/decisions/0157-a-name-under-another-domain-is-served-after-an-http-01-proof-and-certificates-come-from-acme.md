---
status: proposed
summary: A hostname under a domain the platform does not own is allowed only on the external Gateway and is served once an ACME HTTP-01 challenge through that Gateway has passed; external names use HTTP-01, internal names use DNS-01 wildcards per suborg, issuers start on staging and move to production by a recorded outcome, the ClusterIssuers carry no email, and the in-cluster CA stays only for vps before the domain exists.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0157: A name under another domain is served after an HTTP-01 proof, and certificates come from ACME

Source: [issue #1482](https://github.com/corekraft/kore/issues/1482), under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478) (decision 9 and 10 and the naming section).

Refines: [ADR 0042](0042-organization-domains-by-delegation.md) (no TXT path; hosts outside a delegated zone are unsupported; "adding them needs a new ADR") and [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md) ("No ACME issuer is used"; the in-cluster CA as the issuer every shared chart defaults to).

## Context

The record says a hostname under another domain is served only after an ACME challenge proves its DNS points here, certificates come from ACME DNS-01, and internal names get one wildcard per suborg so certificate transparency does not list each name. ADR 0042 forbids both a TXT path and any host outside a delegated zone, and ADR 0142 uses no ACME issuer, because the cluster had no public ingress and no domain.

The platform has no write access to a foreign zone, so DNS-01 cannot prove a foreign name. Let's Encrypt allows 50 new certificates per registered domain and 5 per identical name set every 7 days, so a certificate per short-lived suborg must be planned. A ClusterIssuer's `spec.acme.email` is a plain field in a manifest, the repository is public, and the owner's permanent alert address is run-time only; Let's Encrypt stopped sending expiry emails in 2025.

## Decision

- **A foreign name is served only on the external Gateway, after an HTTP-01 proof.** cert-manager completes an ACME HTTP-01 challenge for it through the external Gateway on port 80. A passing challenge is the proof that its public DNS points at the platform. An internal service that claims a foreign name is refused: the internal Gateway is not publicly reachable, so no proof is possible. The platform never writes DNS for a foreign name (concept 5's external-dns domain filter).
- **Port 80 on the external Gateway serves only a redirect to HTTPS and challenge paths.** The listener serves a name only once its Certificate is Ready. A name that never proves stays unserved without touching any other listener.
- **ADR 0042's "no TXT path" is replaced** by this ACME proof for foreign names; the record's DNS and TXT-registry wording for foreign names is dropped. Names inside the platform domain need no proof (the platform owns the zone).
- **External names use HTTP-01, internal names use DNS-01.** Every external name, own-domain or foreign, takes an HTTP-01 certificate, so cert-manager needs no DNS token for them. Internal names take an ACME DNS-01 wildcard per suborg (`*.<suborg>.<internalDomain>`); the suborg name appears in certificate transparency, which is accepted. The issuer is chosen per Gateway in the overlay, never per app.
- **A separate DNS-edit token.** cert-manager's DNS-01 solver gets its own zone-scoped Cloudflare token in sops, never shared with external-dns or OpenTofu, so each can be revoked alone. Concept 5 creates the tokens and the zone; this decision only says the solver exists, names its Secret and renders no token.
- **Staging first, then production by an outcome.** The dark flag `acme-issuers` renders the Let's Encrypt staging and production ClusterIssuers, and every ACME certificate uses staging. The dark flag `acme-production` switches certificates to the production issuers, after a recorded live-run outcome, because production failures count against rate limits. `acme-issuers` needs the domain to exist, `external-gateway` needs `acme-issuers`, and `acme-production` needs `external-gateway`; all three are false in every overlay and last in the vps order.
  _Refined by issue 1637 (after the principles review): the `external-gateway` to `acme-issuers` prerequisite is not an edge in the flag manifest's `requires`. `acme-issuers` applies to vps alone, and a requires edge binds in every environment its dependant applies to (ADR 0148), so the edge would refuse `external-gateway` in local and managed-example, where neither flag can turn on with the other. The environment check in `tools/kore/src/config/acme-issuers.ts` holds the prerequisite instead: it refuses `external-gateway` on in an environment where the manifest says `acme-issuers` applies and `acme-issuers` is off, naming both flags and the fix; it is silent where `acme-issuers` does not apply. A follow-up (lane-flags) makes a requires edge bind only where the required flag applies, with a dead-edge check; the edge then returns to the manifest and the check goes._
- **No email.** The ClusterIssuers set no `email`. Renewal is watched by an alert on any certificate within 21 days of expiry (the destination is a different concept's), not by a mailbox. The account key lives in its cert-manager Secret in the cluster only.
- **The in-cluster CA's remaining role** narrows to vps before the domain exists (ADR 0142) and to sandbox suborgs: a suborg flagged `sandbox` gets its internal certificate from the in-cluster CA instead of ACME (the owner accepted this on 2026-11-20), so churn never spends the weekly limit. The registry keeps its own CA (ADR 0058). `in-cluster-ca` stays an activated environment flag on vps.

## Consequences

- A foreign name needs its owner to point its public DNS at the platform before the proof passes; a challenge that fails names the ACME error and says so.
- The external Gateway has an HTTP listener on 80 that no other listener shares; a route must name its HTTPS ListenerSet listener as its section so it never attaches on 80.
- Every suborg needs one ACME wildcard: at 50 certificates per week per registered domain, a burst of short-lived suborgs can use the limit. Sandbox suborgs use the in-cluster CA instead, so only suborgs that stay count against it; clients of a sandbox's names trust the CA's public certificate fetched from the cluster, as the proofs do.
- The record's foreign-name wording is narrowed: a foreign name under an owned apex is not special, and a name that is not publicly reachable cannot be claimed at all.
- Public certificates mean clients need no CA install for names served with them, so the pod trust ConfigMap (ADR 0135) is not needed for those names.
