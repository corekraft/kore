---
status: accepted
summary: On k3d, kore publishes images with the node's bundled containerd client through docker exec, with the credential on stdin and held only in a memory-backed hosts.toml; no node shell, and the registry port-forward is ended by platform stop and destroy.
date: 2026-11-11
last-verified: 2026-11-11
---

# ADR 0083: Publish to the registry on k3d through the node's containerd client

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 3](../../infra/plans/9-k3d-local-cluster.md#step-3-images-and-registry-trust)

Refines: [ADR 0034](0034-registry-authentication-and-authorization.md) (the
push path no longer uses `nerdctl login` over `minikube ssh`) and
[ADR 0015](0015-local-signed-image-delivery.md) (publish on k3d).

## Context

ADR 0034's push path runs `nerdctl login --password-stdin` on the node over
`minikube ssh`. k3d has no `minikube ssh`, and ADR 0076 removes node shells.
Two transports remained: push from the host through the registry
port-forward, or run the node's own containerd client with `docker exec`.
A host `docker push` goes through the Docker daemon, which on Docker Desktop
runs in a VM where `127.0.0.1` is not the host, and it would need the registry
CA installed in that daemon; `127.0.0.0/8` is also insecure by default, which
would skip the certificate check ADR 0058 requires.

## Decision

- **Transport: the node's `ctr`.** The k3s node bundles `ctr`. The writer runs
  `docker exec --interactive k3d-<cluster>-server-0 sh -c …`, tags the imported
  image to the registry's ClusterIP address and pushes it. No node shell
  (`ssh`, `minikube ssh`) is used. The registry is verified against its CA.
- **Credential on stdin, never an argument.** `ctr` takes a password only as an
  argument or a terminal prompt, so kore does not use `--user`. Kore sends
  `base64(kore-push:password)` as one line of stdin. The script reads it into a
  shell variable and writes a containerd `hosts.toml` whose `header`
  carries it as `Authorization: Basic …`, together with the public CA, into a
  directory under `/dev/shm`. `ctr … push --hosts-dir` reads it from there.
  A `trap` removes the directory on every exit, including failure.
- **Redaction.** Both the password and its base64 form are redacted from any
  error.
- **Registry port-forward.** The host still needs the forward for the digest
  lookup and for cosign. It is started for k3d as for Minikube, and
  `platform stop` and `platform destroy` end it on k3d too (the tunnel step
  stays Minikube-only).
- **Minikube unchanged.** The `minikube ssh` and `nerdctl` path is untouched.

## Consequences

ADR 0034's guarantees hold on k3d: the push credential is never in an argument
and never on persistent disk. Publishing needs the Docker CLI and a running
k3d server node, which the k3d provider already requires. The `ctr` flags
(`--hosts-dir`, hosts.toml `header`) are proven by specs on the command shape;
the live k3d run proves them against a real node before activation (ADR 0077).
