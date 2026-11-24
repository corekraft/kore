# Run-time values (ADR 0164). None has a default: a person supplies each one as
# a TF_VAR_* from the owner-only run-time file on the machine that applies the
# stack, so the repository never holds a real name, identifier or address.

variable "platform_domain" {
  description = "The platform domain, the one Cloudflare zone this stack imports. Supplied at run time; the repository holds only example.com."
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.platform_domain))
    error_message = "platform_domain must be a lowercase domain name with no trailing dot, for example example.com."
  }
}

variable "cloudflare_account_id" {
  description = "The Cloudflare account that holds the platform zone. Shown on the account's dashboard; supplied at run time, never written here."
  type        = string
}

variable "public_ipv4" {
  description = "The host's public IPv4 address, the address the apex A record publishes. Supplied at run time."
  type        = string

  validation {
    condition     = can(regex("^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$", var.public_ipv4))
    error_message = "public_ipv4 must be one IPv4 address in dotted form; every record of this zone is IPv4 (ADR 0163)."
  }
}
