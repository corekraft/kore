---
status: proposed
summary: The platform domain is one Cloudflare zone imported into a person-applied OpenTofu stack with no backend and no token creation; OpenTofu owns the fixed records (apex, CAA, an anti-spoofing mail set), external-dns owns route records by a TXT ownership record, every record is IPv4 with a 300-second TTL, the owner makes the tokens by hand, ADR 0042's delegation model is retired for vps, and any other domain is a foreign domain Kore never writes.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: One Cloudflare zone holds the platform domain; OpenTofu owns fixed records and external-dns owns route records

Source: [#1483](https://github.com/corekraft/kore/issues/1483), decisions 9 and 10 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478), and the answerer's reasoning on #1483 (2026-11-20)

Refines: [ADR 0042](0042-organization-domains-by-delegation.md) (delegated zones are retired for vps), [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md) (OpenTofu owns account-level state: this adds DNS beside the tailnet stack)

## Context

Record 10 says DNS is Cloudflare, registrar and DNS, proxy off, a zone-scoped
DNS-edit token in sops, OpenTofu owning the zone, apex, CAA and mail records, and
external-dns owning app records through a TXT registry with a domain filter. The
owner has not bought the domain, so this decision builds what can be proven
before it exists.

ADR 0042 assumed an organization delegates a zone to the platform's DNS with NS
records, the `Organization` API checks the delegation through a Crossplane
function, a lapsed delegation has a seven-day grace period, and a host outside a
delegated zone is unsupported. Record 9 instead serves a foreign domain after an
ACME challenge proves its DNS points here, and record 10 keeps every record in
one zone.

The tailnet stack under `infra/tofu/stacks/tailnet` is the precedent for an
account-level OpenTofu stack: applied by a person, no backend, local gitignored
state, credentials from the environment.

## Decision

- **One zone.** The platform domain is one Cloudflare zone. Every other domain,
  including one the owner holds, is a foreign domain: Kore serves it once an
  ACME proof shows its DNS points here, never writes its DNS and holds no
  credential for it.
- **Delegation is retired for vps.** A suborg's default zone is
  `<suborg>.<domain>` inside the one zone: no NS delegation, no delegation check,
  no lapsed-delegation grace. The `Organization` zone field stays. ADR 0042 gets
  a pointer to this decision.
- **A new stack, `infra/tofu/stacks/cloudflare`.** Applied by a person from
  their own machine, never by CI or an agent; CI runs only the offline
  `validate-tofu`. It declares no backend: the state is local, gitignored and holds
  only public facts (zone id, records). The provider version is pinned exactly.
  The domain, the account id and the public address are variables with no
  default, fed from run-time values.
- **The zone is imported, not created.** Registration happens in the Cloudflare
  dashboard and creates the zone, so the stack imports it, with `prevent_destroy`.
  Losing the state is recovered by `tofu import` from a documented list, never by
  data loss; no state backup is kept, because the zone is the source of truth for
  the records.
- **Fixed records, owned by OpenTofu.** The apex, CAA and the mail records.
  Until the owner picks a mail provider the mail set is anti-spoofing only: a
  null MX (`0 .`), SPF `v=spf1 -all` and DMARC `p=reject`. A real provider later
  replaces it by a change to this stack. CAA issue and issuewild name one CA (see
  Open for the owner) and gain the account binding after the first ACME account
  exists. Fixed records may exist before public 443 opens, because they serve
  nothing.
- **Route records, owned by external-dns.** Records for routes, each with an
  ownership TXT record. external-dns never edits a record that has no ownership
  record, so a fixed record is safe by construction. An app can never claim the
  apex or a reserved name; admission enforces that (concept 4).
- **Every record is IPv4 with a 300-second TTL.** No AAAA record exists anywhere
  until a separate change proves the Gateway and the firewall answer over IPv6;
  the host roles carry no public IPv6 handling today. A 300-second TTL, in both
  owners' records, makes an address change live in five minutes. Proxy stays off
  (record 10).
- **The owner makes the tokens by hand.** From a scope list in the runbook
  (Zone Read and DNS Edit, one zone), in the Cloudflare dashboard. OpenTofu never
  creates tokens: a `cloudflare_api_token` resource would put token values in the
  local state, and its bootstrap token would be more powerful than any it makes.
  The OpenTofu token stays on the owner's machine, read from the environment at
  run time, never a file or the cluster. The in-cluster token values go to sops
  and reach the cluster through stdin. Each token has a Cloudflare-side expiry of
  12 months, with no scheduled rotation; rotation is replacing the sops document,
  re-applying it and letting the consumer pod roll. An owner-steps wizard for this
  is a follow-up.
- **Domain lifecycle is an infrastructure event.** An expired registration takes
  every app down. The runbook records an owner checklist (registrar lock,
  auto-renew, two-factor on the Cloudflare account) and an expiry alert is a work
  item: notify-only, read from RDAP on kore-agents once proven (unverified).
- **Public suffix.** ADR 0042's clause to submit the platform domain to the Public
  Suffix List before outside tenants are admitted stays and is not a v1 task: v1
  hosts the owner's own apps, so cookie isolation between suborg subdomains is not
  a v1 property.

## Consequences

- ADR 0141's "OpenTofu owns account-level state (later DNS and a tunnel)" is now
  met by two stacks, tailnet and cloudflare.
- Foreign domains cost the owner a DNS record at their own provider; the platform
  never repairs one.
- Two token Secrets in two namespaces (see the external-dns and ACME decisions)
  mean a revoked token fails one consumer, not both.
- The first live order on vps is: buy, import and apply, owner-made tokens to sops,
  ACME staging proof, production issuer, then external-dns after the external
  Gateway flag.

## Open for the owner

- The registered domain itself (blocking: nothing Cloudflare-specific is provable
  before it exists), and the TLD.
- DNSSEC on for the zone (recommended: yes).
- The CA named in CAA (recommended: Let's Encrypt, staging first).
- The real mail provider, later; the anti-spoofing set stands until then.
- Two in-cluster tokens, one for external-dns and one for cert-manager, rather
  than the one record 10 names (recommended: two, for separate audit and
  revocation).
- Tokens delivered as plain Secrets, outside the ESO `platform-secrets` store the
  OpenBao decision puts behind OpenBao, so DNS and certificates never wait on an
  unseal after the weekly reboot (recommended: yes).
- Hardware-key two-factor on the Cloudflare account (recommended: yes, an owner
  action nothing verifies).
- That cookie isolation between suborg subdomains is not a v1 property
  (recommended: yes).
