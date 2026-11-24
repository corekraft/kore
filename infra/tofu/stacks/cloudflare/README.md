# Cloudflare platform zone stack

The platform domain's one Cloudflare zone
([ADR 0163](../../../../docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md)):
OpenTofu owns the zone's DNSSEC setting and its fixed records, the apex, CAA
and the anti-spoofing mail set. external-dns owns the route records beside
them, and never edits a record without its TXT ownership record, so these fixed
records are safe from it. Every other domain is a foreign domain that Kore never
writes.

The domain is registered in the Cloudflare dashboard, which creates the zone.
The stack imports that zone; it never creates one. The repository uses
`example.com` throughout, and the real values live only in the owner's run-time
file ([ADR 0164](../../../../docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md)).

## What a person does

The stack is applied by a person from their own machine, never by CI or an
agent. CI only validates it offline (`mise run validate-tofu`). It declares no
backend: the state stays in this directory, is gitignored, and holds only public
facts (the zone id, the record ids and values, and the DS record).

Three run-time values have no default. Each is a `TF_VAR_*`, so supply them from
the owner-only run-time file on the machine that applies the stack, and never
type them into a file:

| Variable                       | Source                                | Value                                                          |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------------- |
| `TF_VAR_platform_domain`       | `KORE_PLATFORM_DOMAIN`                | the platform domain, for example `example.com`                 |
| `TF_VAR_public_ipv4`           | `KORE_PUBLIC_IPV4`                    | the host's public address, for example `192.0.2.10`            |
| `TF_VAR_cloudflare_account_id` | the Cloudflare dashboard's account id | not in the run-time file yet (see the open decision in the PR) |

The OpenTofu token is read from the environment as `CLOUDFLARE_API_TOKEN`. It is
never written to a file.

```sh
cd infra/tofu/stacks/cloudflare
set -a; . ~/.kore/runtime.env; set +a   # owner-only file; KORE_* values only
export TF_VAR_platform_domain="$KORE_PLATFORM_DOMAIN"
export TF_VAR_public_ipv4="$KORE_PUBLIC_IPV4"
export TF_VAR_cloudflare_account_id=...  # the account id, from the dashboard
export CLOUDFLARE_API_TOKEN=...          # the OpenTofu token, from the password manager
tofu init
tofu plan     # a plan that would delete the zone is refused by prevent_destroy
tofu apply
```

## Token scopes (made by the owner, by hand)

OpenTofu never creates a token: a token it made would put its value in the
state, and the bootstrap token would be stronger than any it made. Make this
token in the Cloudflare dashboard, from the owner's account:

- Zone: **Zone Read** and DNS: **DNS Edit**, on the one platform zone only.
- Expiry: 12 months, with no scheduled rotation. To rotate, create a new token,
  export it as `CLOUDFLARE_API_TOKEN`, run `tofu plan`, then revoke the old one.

The two in-cluster tokens (external-dns and cert-manager) are made the same way
and documented beside their sops documents in
[`infra/environments/vps/secrets/README.md`](../../../environments/vps/secrets/README.md).

## Import list: recovering from lost state

The zone is the source of truth for the records, so losing the state loses
nothing at Cloudflare. Recover by importing, never by deleting the zone. Each
import reads the id it needs from the Cloudflare API, which is read only:

```sh
export CLOUDFLARE_API_TOKEN=...   # the OpenTofu token
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$KORE_CLOUDFLARE_ZONE_ID/dns_records"
```

1. `tofu import cloudflare_zone.platform <zone_id>`, where `<zone_id>` is the
   value of `KORE_CLOUDFLARE_ZONE_ID`.
2. `tofu import cloudflare_zone_dnssec.platform <zone_id>`.
3. For each record, `tofu import <address> <zone_id>/<dns_record_id>`, with the
   address and the id taken from the API response:
   - `cloudflare_dns_record.apex_address` (the A record at `@`)
   - `cloudflare_dns_record.apex_null_mx` (the MX record at `@`)
   - `cloudflare_dns_record.apex_spf` (the TXT record at `@`)
   - `cloudflare_dns_record.dmarc` (the TXT record at `_dmarc`)
   - `cloudflare_dns_record.apex_caa_issue` (the CAA `issue` record at `@`)
   - `cloudflare_dns_record.apex_caa_issuewild` (the CAA `issuewild` record at `@`)

After the imports, `tofu plan` must show no change. A change it shows is a
drift: reconcile it by reading the plan, never by deleting the zone.

## Registrar checklist (owner)

Register the domain at a Cloudflare-supported registrar. Then check each item
before the first apply:

- **Registrar lock** is on, so the domain cannot be transferred away.
- **Auto-renew** is on. An expired registration takes every app down, and no
  expiry alert exists yet (a follow-up).
- **Two-factor** is on for the Cloudflare account and the registrar account,
  with a hardware key (owner action; nothing verifies it).

## DNSSEC and the DS record

`cloudflare_zone_dnssec` turns DNSSEC on for the zone. The DS record it
produces is `tofu output ds_record`. If the registrar does not publish that DS
record itself, enter it at the registrar in its DNSSEC settings. Whether the
registrar publishes it is not verified yet: the owner checks it when the domain
is bought. Once the domain exists, the owner confirms the chain validates, for
example with `delv example.com SOA`, which reports `fully validated` when the
chain holds.

## Records

Every record is IPv4 with a 300-second TTL, and proxy is off, so an address
change is live in five minutes and nothing is served from Cloudflare's edge.
There is no AAAA record: IPv6 waits for a separate change that proves the
Gateway and the firewall answer over it.

- **CAA** allows only Let's Encrypt, for `issue` and `issuewild`. Staging and
  production issue from the same CA. The account binding is added once the first
  ACME account exists. Because proxy is off, no Cloudflare edge certificate is in
  use. A proxied record would need the CAA set reviewed first, since Cloudflare's
  edge certificates come from CAs this set does not name.
- **Mail** is anti-spoofing only until the owner chooses a mail provider: a null
  MX (`0 .`), SPF `v=spf1 -all` and DMARC `v=DMARC1; p=reject`. A provider later
  replaces it by a reviewed change to this stack.

## Not built here

Applying this stack, the tokens and the DS publication are the owner's steps
after the domain is bought. The offline checks are the only proof this stack
carries until then.
