# zone_id is the run-time value KORE_CLOUDFLARE_ZONE_ID that external-dns and the
# runbook read (ADR 0164). ds_record is entered at the registrar when the
# registrar does not publish the DS record itself (README.md).

output "zone_id" {
  description = "The imported zone's id, the value of KORE_CLOUDFLARE_ZONE_ID in the owner-only run-time file."
  value       = cloudflare_zone.platform.id
}

output "ds_record" {
  description = "The full DS record for the zone's DNSSEC key; enter it at the registrar when the registrar does not publish it."
  value       = cloudflare_zone_dnssec.platform.ds
}
