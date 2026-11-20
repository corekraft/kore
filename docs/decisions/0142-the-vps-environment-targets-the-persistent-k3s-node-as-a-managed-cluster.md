---
status: accepted
summary: The vps environment overlay points kore at the persistent single-node k3s on the rented VPS as a managed cluster, with an in-cluster registry on a pinned ClusterIP, the local domain kore.internal, an internal root CA that cert-manager creates inside the cluster under local's issuer names, and its own sops recipient to come, and every feature flag off, so the overlay validates and changes nothing in any cluster until a live run and harness flag activate.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0142: The vps environment targets the persistent k3s node as a managed cluster

Refines [ADR 0012](0012-environment-overlays-hold-provider-specifics.md), which keeps provider specifics in overlays, and builds on [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md), which converges the host and its k3s.

## Context

ADR 0141's Ansible role runs a single-node k3s on the rented VPS host, and
kore has no environment to target it. Kore created its k3d and managed
clusters through overlays, but this cluster is neither: Ansible installs and
owns it, and kore only deploys to it. Kore needs an overlay, so `kore validate`
and the platform charts can address it, without that overlay turning anything on.

The cluster's facts are: k3s v1.37.2+k3s1 on one node, SQLite datastore,
Traefik and servicelb disabled, the `local-path` storage class as default,
the k3s default service CIDR `10.43.0.0/16` (the kubernetes service's ClusterIP
and CoreDNS's sit in it, and the three services the cluster runs hold
`10.43.0.1`, `10.43.0.10` and `10.43.220.26`), eight threads and about 64 GiB
RAM shared with a 6-CPU, 40 GiB agents VM, and an API reachable only over the
tailnet. The repository is public, so no public address, tailnet address or
MagicDNS name beyond the bare host name `kore-vps` belongs in it. The owner has
not bought a domain, so no real domain belongs in it either.

## Decision

- **A managed overlay, not a k3d one.** `infra/environments/vps` has provider
  `managed`, cluster profile and driver `external` (kore does not create the
  cluster), containerd and Kubernetes `1.37.2`, matching `managed-example`.
  The context is `kore-vps`, the name the Ansible role writes.
- **Sized for kore, with room for the VM.** `cpus` 4 and `memoryMB` 20480
  (20 GiB) leave the agents VM its 40 GiB cap and the host the rest of the
  64 GiB. k3s already outranks the VM for CPU and IO (ADR 0141), so the
  declared share is what kore may plan for, not a reservation. `diskSize` is
  `300g`, the k3s data volume.
- **The local domain convention.** `platform.domain` is `kore.internal`
  with organization `platform`. The name resolves nowhere public, so nothing
  reaches the internet by it, and it is never a bought domain. The cluster is
  reached only over the tailnet, so the name is tailnet-only by design.
- **An in-cluster registry on a pinned ClusterIP, as local does.**
  `registry.address` is `10.43.0.50:5000`. An IP literal makes the `oci-registry`
  chart pin its Service to that ClusterIP and port (ADR 0031), and
  `cluster.serviceCidr` `10.43.0.0/16` contains it, so validation checks the
  address. `10.43.0.50` is outside the services the cluster runs. The registry's
  own serving certificate comes from its chart's self-signed CA (ADR 0058), so
  the registry needs no ACME and no public name.
- **An internal CA created inside the cluster, under local's names.**
  `issuer.name` is `kore-local-ca` and the gateway certificate's Secret is
  `kore-local-tls`, the names local uses. The names are defaults in the shared
  charts (the golden-path workload's ingress, the PostgreSQL API, Backstage,
  the platform-certificate and platform-config charts) and in the catalog's
  readiness checks, so a vps-only name would mean overriding every one of them
  for no gain; "local" in the name is history, not a statement that the CA is
  mkcert's. No ACME issuer is used.
- **The CA is made by cert-manager in the cluster, so its key never leaves it.**
  Local's CA is an mkcert root that `kore trust install` copies in from the
  developer's machine. Copying that root to the rented host would put its
  private key there, and `installLocalTrust` refuses a non-k3d provider for that
  reason. The `in-cluster-ca` flag, passed to every chart like the
  others, makes the `platform-certificate` chart (the `kore-local-tls` release) render a `SelfSigned` ClusterIssuer
  (`kore-local-selfsigned`), a CA Certificate `kore-local-ca` in the
  `cert-manager` namespace (`isCA`, ECDSA P-256, key rotation `Never`, ten
  years so the root outlives what it signs) whose Secret is
  `kore-local-ca-key-pair`, and the `kore-local-ca` ClusterIssuer that signs
  with it. The Secret name matches local's, so the readiness preflight and
  `loadLocalCa` read the public `tls.crt` the same way for both. The flag
  is off in every overlay, so nothing renders until a live run and
  `harness flag activate` turn it on for vps; local renders what it did and
  keeps one owner for its CA (`kore trust install`). `kore validate` refuses
  the flag on for a k3d environment, because two owners would fight over one
  ClusterIssuer. On vps the chart is the one owner, and `kore trust install`
  stays refused there. The repository holds no key and no
  certificate, and the controller needs only the public root.
- **The policy controller trusts the registry CA, as local does.** The overlay
  layers `values/policy-controller.yaml` beside the mirror values: the verifier
  reads signatures from the in-cluster registry over TLS and trusts only the
  `kore-registry-ca` bundle (ADR 0058). The webhook keeps no disruption budget,
  for the same single-node reason as local.
- **The release mirror, not upstream.** Like `managed-example`, the overlay
  pulls every approved image from the signed, digest-pinned mirror
  (ADR 0044), with the same keyless image trust over the release tags. No
  local signing key is declared, because a managed environment trusts only
  keyless signers (ADR 0059).
- **Its own sops recipient, separate from local's.** The environment's secrets
  are encrypted to a recipient the owner creates on the controller; the private
  key never enters the repository. `infra/environments/vps/secrets/README.md`
  holds the owner steps. The SOPS creation rule is not written yet: the local
  sops spec asserts that the whole `.sops.yaml` holds no placeholder string, so
  a placeholder rule for vps would break that guard. The rule waits for the
  public recipient the owner creates.
- **Every flag off.** All feature flags are listed and `false`. A flag turns on
  only through `harness flag activate` after a recorded live-run outcome
  (ADR 0077), so this change alters nothing that runs in the cluster.

## Consequences

- `mise run validate` checks `vps` in CI beside `local` and `managed-example`,
  so a broken overlay fails before merge.
- `kore trust install` refuses any non-k3d provider (`installLocalTrust`,
  "local CA trust is only valid for a local k3d environment") and still does:
  the owner decided (2026-11-20) that vps creates its CA in the cluster rather
  than copying one in. The `kore-local-ca` ClusterIssuer and its CA Secret appear
  in the vps cluster when the `kore-local-tls` release is installed. Until then
  the gateway and the platform's certificates wait, and the readiness check
  fails closed. Its remedy text for a non-local environment still reads
  "Create the ClusterIssuer and its CA Secret for this environment".
- The Argo CD AppProject that `platform-config-delivery` renders admits the
  `ClusterIssuer` kind and the `cert-manager` namespace only while
  `in-cluster-ca` is on: kore passes the chart `inClusterCa` then, as it passes
  `databaseRoutes` for its flag (ADR 0137). Its spec renders every argocd-owned
  release with every flag on, and the CA objects join that render. With the flag
  off, local's delivered project is byte-identical to what it was. `vps` keeps
  `platform-argocd-delivery` off, so Helm delivers its release.
- The CA is proven only by a live run. The flag is off, so nothing in any cluster
  changes until the owner runs `kore platform up --environment vps` on the
  controller with the flag on, sees `clusterissuer/kore-local-ca` Ready and
  `secret/kore-local-tls` issued, and records the outcome for
  `harness flag activate`.
- The node's containerd must trust the in-cluster registry's CA to pull from it.
  On k3d that trust is written at create (`k3d-registry-trust.ts`). On the vps
  host it is a k3s registries file that the Ansible role (ADR 0141) would own,
  and no role writes it yet.
- The overlay copies managed-example's mirror and manifest values, so the two
  overlays drift apart whenever the release mirror changes; the copies must
  be updated together until one shared source exists.
- No live proof exists for this environment yet. Turning a flag on for `vps`
  needs its own live run and activation, and any cluster change needs a
  separate decision.
