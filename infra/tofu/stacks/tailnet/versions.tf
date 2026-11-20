terraform {
  required_version = "1.13.9"

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "0.30.0"
    }
  }
}
