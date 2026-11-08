---
status: accepted
summary: The internal registry sits behind an nginx auth proxy sidecar; kore generates a push and a read-only credential, streams them as Secrets, and only its publish path holds the push credential. The NodePort is gone and readiness is a TCP check.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0034: Authenticate and authorize the internal registry with a proxy sidecar

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: [ADR 0015](0015-local-signed-image-delivery.md) (the push and verify
path now authenticates) and [ADR 0031](0031-registry-address-platform-variable.md)
(the Service is no longer a NodePort).

## Context

The `oci-registry` release accepted anonymous push and pull, and a NodePort
exposed it on the node. Anything that could reach the node could replace an
image; only the signature check stood between that and a deployment.
Distribution `registry:3.1.2` offers `htpasswd` authentication but no
authorization: every user may push and pull. Token auth would need a token
service, a second stateful component.

## Decision

- **Proxy sidecar.** A second container in the registry pod runs
  `nginxinc/nginx-unprivileged:1.31.7-alpine3.24`, pinned by index digest. The
  registry listens on `127.0.0.1:5001` only; the proxy listens on `5000`, which
  the Service targets. nginx authenticates with basic auth and authorizes by
  method: any authenticated identity may `GET` or `HEAD`, only `kore-push` may
  write. A request with no credentials gets `401` and a `WWW-Authenticate`
  challenge; the read identity writing gets `403`.
- **Seed.** The proxy starts with the registry before any signature can be
  verified, so it is a seed (`seeds.yaml`, component `oci-registry`) with a
  catalog pin, a reason, and Docker Hub digest evidence. NGINX publishes no
  Cosign signature for it.
- **Two identities.** `kore-push` (read and write) and `kore-read` (`GET`/`HEAD`
  only). Each password is 256 random bits from `crypto.randomBytes`.
- **Generation and storage.** `kore platform up` creates the credentials before
  the registry release, in memory, and streams them through
  `kubectl apply --filename=-`: the `kore-registry/oci-registry-credentials`
  Secret (plaintext, read back by kore) and `oci-registry-auth` (an htpasswd
  of hashes, mounted by the proxy). Existing credentials are reused, never
  rotated, so a rerun cannot break live pods. Nothing is written to disk or
  appears in an argument.
- **Hash.** htpasswd uses `{SHA}` (SHA-1, base64), not bcrypt. A bcrypt hash
  needs a dependency or a host `htpasswd` binary, and a slow hash adds nothing
  to a 256-bit random password. This departs from the "bcrypt" wording of the
  request deliberately.
- **Push path.** Only the publish path loads the push credential.
  - On the node, `nerdctl login --password-stdin` reads it from stdin into a
    Docker config on `/dev/shm` that the script removes on exit.
  - For cosign, a Docker config with `credsStore: kore-env` and a helper that
    answers only `get` from the child's environment sit in a temporary
    directory deleted afterwards. Neither file holds the secret.
  - The digest lookup sends an `Authorization` header from memory.
- **Pull path.** `kore app up` verifies with `kore-read` through the same
  helper, and the node pulls the staged image with `nerdctl login` of the same
  identity. Enrollment applies a `kore-registry-read` `dockerconfigjson`
  Secret and an `imagePullSecrets` entry on the namespace's default
  ServiceAccount, because Policy Controller resolves signature credentials from
  the pod's pull secrets. The push credential never leaves `kore-registry`.
- **External registries.** When `registry.address` is a hostname, kore
  distributes and loads nothing; the provider owns those credentials.
- **No NodePort.** Nodes and pods use the pinned ClusterIP; kore uses a
  port-forward to the Service. The Service is `ClusterIP`.
- **Readiness.** The proxy uses a TCP probe on its port (bounded, independent
  of the `401` from `/v2/`); the registry container uses `nc -z` on loopback.
  Component readiness stays `deployment/oci-registry`.

## Rejected

- **Token auth.** Per-repository scopes, but a token service to run, secure,
  and seed.
- **One shared credential.** Smallest, but any puller could push.
- **Docker config login on disk.** Leaves a reusable secret in a file.

## Consequences

- Manual `docker push` or `nerdctl push` gets `401`. Developers publish
  through `kore local up`, which is unchanged for them.
- A registry credential is as long-lived as its Secret. Rotation means
  deleting `oci-registry-credentials`, rerunning `kore platform up`, and
  redeploying apps so their pull Secrets refresh.
- The credential Secret is cluster-readable to anyone who can read Secrets in
  `kore-registry`; RBAC for that namespace is a Step 8 and 9 concern.
- Policy Controller's credential lookup, `minikube ssh` forwarding stdin, the
  nginx method rules, and the alpine `nc` probe are validated by the live
  checks in the plan, not by the fast tests.
