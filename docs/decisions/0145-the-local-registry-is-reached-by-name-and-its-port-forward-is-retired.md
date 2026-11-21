---
status: accepted
summary: A k3d registry is always reached through its name on the shared Gateway, the local kubectl port-forward is retired and no host caller starts one, while the tailnet forward of ADR 0143 keeps its owner record.
date: 2026-11-21
last-verified: 2026-11-21
---

# ADR 0145: The local registry is reached by name, and its port-forward is retired

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 3](../../infra/plans/9-k3d-local-cluster.md#step-3-images-and-registry-trust)

Refines: ADR 0143

## Context

ADR 0143 kept the local registry's kubectl port-forward on `127.0.0.1:30500` and gave the managed tailnet path the same forward. ADR 0132 then put the registry on the shared Gateway under its name, `registry.platform.<domain>`, behind `registry-by-name`. The names run on 2026-11-21 (#1225, #1216) proved that digest lookup, cosign verification and pruning reach the registry by name with its own certificate verified, with no port-forward running. Nothing on the local path needs the forward any more.

## Decision

- **A k3d registry is reached by its name, always.** Host-side callers (digest lookup, cosign, pruning, the publish session) dial `registry.<organization>.<domain>` with no port. The shared Gateway answers on 443 (ADR 0132).
- **The local port-forward is retired.** No host caller starts a `kubectl port-forward` to a k3d registry. A k3d environment with `registry-by-name` off is refused, naming the flag, before any port-forward starts or any registry CA is read, because nothing else reaches it.
- **The tailnet forward keeps its path.** ADR 0143 is unchanged: the managed forward behind `registry-tailnet-forward` keeps its command, its readiness probe and its owner record at `~/.kore/registry-forward/<context>.json`. ADR 0094's stop rules still apply to it.
- **A forward left by an older kore is still stopped.** `platform stop` and `platform destroy` keep ending a registry forward that a worktree or process recorded for a k3d context, so an upgraded checkout does not orphan one. Nothing starts a new one.
- **`registry-by-name` stays a flag.** Retiring the flag is a later decision; the flag still gates the Gateway route and the registry's certificate name.

## Consequences

- A k3d environment needs `registry-by-name` on to publish, verify or prune. The local overlay has it on, so `kore local up` is unchanged for it; a local overlay with the flag off now stops with a message instead of starting a forward.
- A managed environment is unchanged while `registry-tailnet-forward` is off, which is every overlay today.
- ADRs 0058, 0060, 0062, 0083, 0094, 0132, 0140 and 0143 stay as history. Guides, specs and the index describe the forward only as the tailnet path, or as history.
- The chart comments in `infra/charts/oci-registry` that mention the host's port-forward are left for a later chart change, since a chart edit moves the content-addressed chart lock.
