# Tailnet stack

The tailnet's access policy and the tags of the kore machines
([ADR 0141](../../../../docs/decisions/0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md):
OpenTofu owns account-level state).

- `kore-vps` is `tag:vps`, `kore-agents` is `tag:agents`.
- People reach every device, and Tailscale SSH reaches the host as `debian`.
- Tagged machines have no grant, so the agents VM cannot reach the host or the
  k3s API, and neither machine can reach a person's devices.

A person applies it from their own machine; CI only validates it offline
(`mise run validate-tofu`). It declares no backend: the state stays here,
gitignored, and holds no secret because the stack creates no auth keys.

```sh
cd infra/tofu/stacks/tailnet
export TAILSCALE_API_KEY=...   # an access token with a short expiry, never a file
tofu init
tofu plan     # the first plan replaces the tailnet's default policy
tofu apply
```

Tagging a device detaches it from the person who signed it in, and Tailscale
turns off key expiry for tagged devices.
