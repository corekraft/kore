---
status: accepted
summary: The internal registry's nginx proxy serves TLS only, with a certificate from a kore-owned cert-manager CA; every client verifies that CA and no plain-HTTP path remains.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0058: Serve the internal registry over TLS and verify it everywhere

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: [ADR 0034](0034-registry-authentication-and-authorization.md) (the
proxy authenticated but carried basic-auth credentials over plain HTTP) and
[ADR 0031](0031-registry-address-platform-variable.md) (the pinned address is
now also a certificate SAN).

> Refined by [ADR 0084](0084-k3d-registry-trust-through-a-mounted-ca-directory.md): on k3d, nodes trust the CA through a mounted directory
> (`registries.yaml` and `ca_file`), and [ADR 0083](0083-k3d-publishes-through-the-node-containerd-client.md)
> publishes with `ctr`. Together they replace the Clients bullet's node containerd and
> nerdctl `certs.d` path on k3d.

## Context

Clients reached the registry with `nerdctl --insecure-registry`, cosign
`--allow-http-registry`, and `http://127.0.0.1:30500` lookups. Credentials and
image bytes crossed the node network unencrypted. Distribution's own client
library (go-containerregistry, used by cosign and Policy Controller) also tries
plain HTTP as a fallback for loopback and private addresses when HTTPS fails,
and no setting turns that off. The server therefore has to be the closed door.

## Decision

- **Server.** TLS terminates at the existing nginx proxy (`listen 5000 ssl`,
  TLS 1.2+). It has no plain listener, so a client's HTTP fallback gets nothing.
  The registry stays on loopback.
- **CA.** The `oci-registry` chart renders a namespace-scoped self-signed
  Issuer, a CA Certificate, a CA Issuer, and the serving Certificate
  (`oci-registry-tls`). The CA key lives only in Secret `oci-registry-ca` and
  never leaves the cluster; kore reads only the public `ca.crt`. SANs: the
  pinned `registry.address` (IP or host), `127.0.0.1` for the port-forward, and
  the Service DNS names. cert-manager is already a bootstrap component, so
  `oci-registry` now depends on `cert-manager` and waits for
  `certificate/oci-registry-tls`; `policy-controller` depends on `oci-registry`.
- **Distribution.** After the registry release, `kore platform up` reads the CA
  and applies it (stdin, server-side) as ConfigMap `cosign-system/kore-registry-ca`,
  and on k3d writes it into the host directory mounted into every node
  at cluster create (ADR 0084). That path is provider-specific, so it lives in the
  environment path, not the chart. External (hostname) registries are the
  provider's to trust; kore distributes nothing.
- **Clients.** Node containerd and nerdctl use `certs.d` (no
  `--insecure-registry`). Host cosign gets `--registry-cacert` on `sign` and
  `verify` through a temporary public-cert file. Kore's own digest lookup and
  port-forward probe use `node:https`/`node:tls` with that CA and
  `rejectUnauthorized`. Policy Controller mounts the ConfigMap through the
  chart's `webhook.registryCaBundle` (chart 0.10.8 sets `SSL_CERT_DIR` to the
  mount plus the system roots), set only in the local overlay.
- **Fail closed.** A missing or non-PEM CA stops every client path with an error
  naming `kore platform up --env <env>`. `kore platform status` has a
  `registry-trust` row that is degraded without the CA, which keeps the
  admission gate closed.
- **Idempotent and migrating.** The Certificate persists across runs, so a
  second run reissues nothing; trust is reapplied with identical content. An
  existing profile upgrades in one `local up`: cert-manager, then the registry
  release (new chart hash, so it upgrades), then trust, then Policy Controller.
  Stored images survive; the gate is closed throughout.

## Consequences

- The proxy reads its certificate at start. Leaf and CA last ten years
  (`tls.duration`), so renewal is not expected; rotation is manual and not
  built: delete `oci-registry-tls` (and `oci-registry-ca` for the CA), rerun
  `kore local up`, then `kubectl rollout restart deployment/oci-registry`.
  Rotating the CA also needs the node directory and ConfigMap refreshed, which
  `local up` does.
- Policy Controller cannot be told not to fall back to HTTP; the closed server
  port is what enforces it. Pods that do not mount the CA cannot read the
  registry.
- Managed environments with an in-cluster registry must deliver the CA to their
  nodes themselves.
- Live checks are listed in the plan note: containerd honoring `certs.d` on the
  pinned Minikube node, `SSL_CERT_DIR` working in the 0.13.1 image, and the
  first-run migration.
