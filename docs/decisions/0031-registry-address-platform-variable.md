---
status: accepted
summary: Each environment declares one registry.address; the oci-registry Service pin, the image-policy glob, and image references for push, sign, and deploy all derive from it at render and reconcile time, and committed values files may not repeat it.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0031: The registry address is a per-environment platform variable

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: [ADR 0028](0028-image-trust-authority.md) (the registry host was written in three places) and [ADR 0012](0012-environment-overlays-hold-provider-specifics.md) (the registry location is a provider specific that belongs to the environment).

## Context

The local registry address `10.96.0.50:5000` was typed into the oci-registry
values, the image policy glob, and, through a live Service lookup, the push and
deploy references. Validation only checked that the copies agreed. Moving the
address, or running the same platform against a remote cluster whose registry is
a hostname, meant editing several files in step.

## Decision

- **One variable.** `registry.address` (`host[:port]`) in `environment.yaml` is
  the only place the registry location is written. The schema requires it.
- **Derived, never duplicated.** Kore passes `--set-string
platform.registry.address=<address>` to the `oci-registry` and
  `kore-image-policy` releases and to every application release, extending the
  existing `platform.*` contract. The image-policy chart renders its glob as
  `<address>/**`. When the address is an IPv4 literal Kore also passes
  `service.clusterIP` and `service.port` to the registry chart.
- **Local versus remote.** An IPv4 address means the environment provides the
  in-cluster registry: it must lie inside `cluster.serviceCidr`, the Service is
  pinned to it, and a drifted Service is recreated (ADR 0028 rewiring). A
  hostname means an external registry: no Service is pinned and nothing is
  rewired.
- **No copies.** Validation rejects `service.clusterIP`, `service.port`,
  `trust.images`, and any registry host inside the values overlays of the
  components that receive the variable. The glob is also checked against the
  seed images so the address cannot cover public images.
- **Consumers use the variable, then check it.** Push, sign, and deploy
  references use `registry.address`. They first confirm that the in-cluster
  Service answers there and otherwise fail naming `kore platform up`.
- **Adoption.** Editing only `registry.address` converges a live profile:
  `platform up` recreates a drifted Service, upgrades the image-policy release
  (configuration-phase components are always upgraded), and `local up`
  redeploys apps. Running pods keep their old references until redeployed.
  `kore platform render` shows the derived values without a cluster.

## Consequences

- Changing the address is a one-line edit; every consumer follows.
- A remote environment names its registry hostname once; Kore pins nothing.
- Changing only the port of a live in-cluster address is not detected by
  rewiring (Service ports are mutable); rerun the oci-registry release.
- The image lock still records a registry host in `images.lock.json`; consumers
  replace it with `registry.address`, so it is a label, not an address.
