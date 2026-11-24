# The platform domain's one Cloudflare zone (ADR 0163): imported, never created,
# with the DNSSEC setting and the fixed records OpenTofu owns. external-dns owns
# route records beside them and never edits a record without its TXT ownership
# record, so nothing here is at risk from it.
#
# Applied by a person from their own machine, never by CI or an agent. No
# backend is declared: state stays in this directory, gitignored, and holds only
# public facts. The stack creates no token (see the runbook in README.md).
#
# The zone is registered in the Cloudflare dashboard, then imported once:
#   tofu import cloudflare_zone.platform <zone_id>

provider "cloudflare" {}

resource "cloudflare_zone" "platform" {
  account = {
    id = var.cloudflare_account_id
  }
  name = var.platform_domain
  type = "full"

  # The zone is the source of truth for every record. Losing it would take every
  # app down, so a plan that would delete it is refused, never applied.
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zone_dnssec" "platform" {
  zone_id = cloudflare_zone.platform.id
  status  = "active"
}

# The apex address. It is IPv4 with a 300-second TTL, and proxy is off, so an
# address change is live in five minutes and nothing is served from Cloudflare's
# edge.
resource "cloudflare_dns_record" "apex_address" {
  zone_id = cloudflare_zone.platform.id
  name    = "@"
  type    = "A"
  content = var.public_ipv4
  ttl     = 300
  proxied = false
}

# Anti-spoofing mail set, until the owner chooses a mail provider (ADR 0163): the
# domain sends no mail, says so with a null MX, and rejects every sender that
# claims it.
resource "cloudflare_dns_record" "apex_null_mx" {
  zone_id  = cloudflare_zone.platform.id
  name     = "@"
  type     = "MX"
  content  = "."
  priority = 0
  ttl      = 300
  proxied  = false
}

resource "cloudflare_dns_record" "apex_spf" {
  zone_id = cloudflare_zone.platform.id
  name    = "@"
  type    = "TXT"
  content = "v=spf1 -all"
  ttl     = 300
  proxied = false
}

resource "cloudflare_dns_record" "dmarc" {
  zone_id = cloudflare_zone.platform.id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject"
  ttl     = 300
  proxied = false
}

# Only Let's Encrypt may issue for the zone, for names and for wildcards. The
# account binding is added once the first ACME account exists.
resource "cloudflare_dns_record" "apex_caa_issue" {
  zone_id = cloudflare_zone.platform.id
  name    = "@"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
  ttl     = 300
  proxied = false
}

resource "cloudflare_dns_record" "apex_caa_issuewild" {
  zone_id = cloudflare_zone.platform.id
  name    = "@"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issuewild"
    value = "letsencrypt.org"
  }
  ttl     = 300
  proxied = false
}
