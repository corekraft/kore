---
status: accepted
summary: The controller reaches a managed cluster's in-cluster registry through a kubectl port-forward over that cluster's own kube context, which already runs over the tailnet, behind the registry-tailnet-forward flag, off in every overlay; the registry gets no listener of its own and the push transport stays an owner decision.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0143: The controller reaches a managed registry through a forward over the tailnet

Refines [ADR 0094](0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md), which gives the local registry forward an owner, and builds on [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md), which makes the vps registry an in-cluster ClusterIP.

## Context

Kore reaches a k3d cluster's registry from the host through one `kubectl port-forward` on `127.0.0.1:30500`, started on the local context and owned by its worktree (ADR 0094). The forward is keyed by context, but `ensureRegistryForward` and `localRegistryReference` return early for any provider but k3d, so a managed environment never starts one.

The vps registry is `10.43.0.50:5000`, a ClusterIP that only the cluster reaches (ADR 0142). The controller reaches the cluster's API server over the tailnet, through the `kore-vps` context. Issue #1404 gap 3 asks for a path from the controller to that registry that does not expose it publicly.

## Decision

- **Reuse the forward, through the managed context.** The controller runs `kubectl --context <environment kube context> --namespace kore-registry port-forward service/oci-registry 30500:5000`, the same command the k3d forward runs. The API server is the endpoint the tailnet already carries, so the registry gets no listener, public or tailnet, and the node opens no port.
- **Scope is narrow.** The forward applies only to a `managed` environment whose `registry.address` is an IPv4 ClusterIP, and only when `registry-tailnet-forward` is on. A k3d environment keeps the path it has, and an external registry named by hostname keeps its reference and starts nothing.
- **The flag is dark.** `registry-tailnet-forward` is false in every overlay. The owner turns it on for the vps run and records the outcome for `harness flag activate` (ADR 0077), as the in-cluster CA and the k3s registry trust were turned on.
- **The forward keeps one owner record.** It is recorded at `~/.kore/registry-forward/<context>.json` like any other, so each context has its own owner and the stop rules of ADR 0094 apply unchanged.
- **Only a verified forward answers.** The forward is ready when `GET /v2/` answers over TLS verified against the registry's CA (ADR 0058, read from the cluster's `oci-registry-tls` Secret). A forward to anything else never counts as ready.
- **Host callers dial the forward.** With the flag on, `localRegistryReference` rewrites the registry host to `127.0.0.1:30500`, and `verifyImage` verifies that reference over TLS with the read credential and the registry CA, as the local environment does. With the flag off, both paths are what they were.
- **The push transport is not decided here.** On k3d the bytes move by `docker exec` into a node's containerd (ADR 0083), and a k3s node has no docker node to exec into. How the controller pushes to the vps registry is an open owner decision; this ADR only makes the registry reachable from the controller, so `withPublishSession` stays refused for a managed environment.
- **One host port.** A k3d forward and a vps forward on the same controller share `127.0.0.1:30500`. The CA check makes a forward to the other registry not ready, and the start fails naming the port, so the collision fails closed. Moving the vps forward to another port is a later decision.

## Consequences

- With the flag off nothing changes: the k3d path, the managed-example path and the vps path are as they were, and no overlay turns anything on.
- The proof is owed on [#1404](https://github.com/corekraft/kore/issues/1404). On the controller, with the flag on for vps, the owner runs `kore app up <name> --environment vps` for an image already in the vps registry. The forward starts, the image is verified over it, and the command stops before any cluster change if verification fails. The outcome is recorded for `harness flag activate`.
- No live run exists yet, so the forward is unproven on `kore-vps`. This ADR changes no cluster object, so it needs no separate decision for the cluster.
