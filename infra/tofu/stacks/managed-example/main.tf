# Offline-validated contract stack. It declares no backend, no credentials, and
# no cloud resource: a provider module is added only after a reviewed
# portability decision. CI runs `mise run validate-tofu`; nothing applies it.

variable "environment" {
  description = "Name of the Kore environment this stack serves."
  type        = string
  default     = "managed-example"
}

resource "null_resource" "contract" {
  triggers = {
    environment = var.environment
  }
}

output "environment" {
  description = "Environment the stack serves; the contract surface for future modules."
  value       = var.environment
}
