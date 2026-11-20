# The tailnet's access policy and the tags of the kore machines.
#
# Applied by a person from their own machine, never by CI or an agent. It
# declares no backend: state stays in this directory, is gitignored, and holds
# no secret (this stack creates no auth keys). Credentials come from the
# environment at run time: TAILSCALE_API_KEY (an access token with a short
# expiry), never a file.

provider "tailscale" {}

locals {
  policy = {
    tagOwners = {
      "tag:vps"    = ["autogroup:admin"]
      "tag:agents" = ["autogroup:admin"]
    }

    # People reach every device. Tagged machines get no grant of their own, so
    # they cannot open a connection to any other tailnet device: the agents VM
    # never reaches the host or the k3s API, and neither machine reaches a
    # person's laptop or phone.
    grants = [
      {
        src = ["autogroup:member"]
        dst = ["*"]
        ip  = ["*"]
      },
    ]

    ssh = [
      # Tailscale SSH to the host, as the admin account only.
      {
        action = "accept"
        src    = ["autogroup:member"]
        dst    = ["tag:vps"]
        users  = ["debian"]
      },
      # Tailscale's default for a person's own untagged devices.
      {
        action = "check"
        src    = ["autogroup:member"]
        dst    = ["autogroup:self"]
        users  = ["autogroup:nonroot", "root"]
      },
    ]
  }
}

resource "tailscale_acl" "policy" {
  acl = jsonencode(local.policy)
  # The first apply replaces the tailnet's default policy; review the plan.
  overwrite_existing_content = true
}

data "tailscale_device" "vps" {
  hostname = "kore-vps"
  wait_for = "60s"
}

data "tailscale_device" "agents" {
  hostname = "kore-agents"
  wait_for = "60s"
}

resource "tailscale_device_tags" "vps" {
  device_id = data.tailscale_device.vps.node_id
  tags      = ["tag:vps"]

  depends_on = [tailscale_acl.policy]
}

resource "tailscale_device_tags" "agents" {
  device_id = data.tailscale_device.agents.node_id
  tags      = ["tag:agents"]

  depends_on = [tailscale_acl.policy]
}
