---
status: accepted
summary: Environment overlays select implementations and hold all Minikube and provider specifics; a provider-neutral managed-example environment validates portability offline.
date: 2026-09-13
last-verified: 2026-11-07
---

# ADR 0012: Keep provider specifics in environment overlays

Source: [`infra/plans/1-initialize.md` § Environment Overlay Rules](../../infra/plans/1-initialize.md#environment-overlay-rules)
and [`infra/plans/2-implementation.md` § Step 14](../../infra/plans/2-implementation.md#step-14-portability-and-resilience-validation)

## Context

Applications must move between local and managed environments by changing
configuration only. Step 14 also required choosing a second, non-local
environment to prove that.

## Decision

- `infra/environments/common` holds portable contracts and safe defaults.
  `infra/environments/<name>` holds only that environment's inputs and Helm
  values; application directories never import them.
- An overlay may select implementations, sizes, endpoints, issuers, storage
  classes, compositions, and platform-owned parent references. It must not fork
  an application chart or change application source.
- Minikube commands, profiles, tunnels, mounts, and local registry bootstrap
  exist only in the local environment and `kore` adapters. Cloud names,
  regions, identities, and managed-resource settings exist only in their
  OpenTofu stack and overlay.
- Secrets are referenced by stable logical keys; registry endpoints, trusted
  signer identities, and public verification material are environment inputs;
  private signing credentials never are.
- The second environment is `managed-example` with a generic `managed`
  provider. It is validated offline (`kore validate --environment
managed-example`) without credentials. A specific cloud provider is selected
  in its own ADR before live support is claimed.

## Consequences

Offline portability checks run in ordinary CI. Live provider tests stay opt-in
because they need credentials and cost money, and provider support is
documented only after one passes.
