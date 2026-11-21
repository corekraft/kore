---
status: proposed
summary: Application secrets are read through one ClusterSecretStore per suborg, limited to that suborg's namespace and its own source namespace, replacing the single shared store for applications; where the secret values are authored and stored is an open owner decision with a recommendation.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: Each suborg reads its own secret store, and where secret values live is open

Source: [issue #1484](https://github.com/corekraft/kore/issues/1484), under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478) (the app secrets gap and decisions 12 and 14).

Refines: [ADR 0009](0009-encrypted-secrets-through-external-secrets.md). Builds on the suborg layout in the ADR "A suborg is the namespace, quota and trust boundary of its services".

## Context

The `platform-secrets` ClusterSecretStore reads one namespace, `kore-secret-source`, and any ExternalSecret in any namespace can name any key in it. With several suborgs that lets one suborg read another's secrets. The vps environment has its own age recipient in `.sops.yaml`; its private key stays on the owner's controller, and plaintext moves only through stdin. Application repositories are outside the Kore repository's hooks (`secret-path`, `sops-plaintext`).

## Decision

- **One ClusterSecretStore per suborg,** with `conditions.namespaces` limited to that suborg and its own source namespace, both made by the Organization composition. This uses upstream External Secrets and reimplements nothing. It replaces the shared store for applications; the platform's own releases keep `platform-secrets`.
- **The no-plaintext rule extends to applications.** The existing `KoreSecrets` constraint (a sensitive env name set as a literal) covers every suborg namespace, in audit first, promoted by [ADR 0072](0072-constraint-promotion-procedure.md). A plaintext scan of the application repository is one of the platform workflow's deterministic evals, and a hit refuses the attestation.
- **A secret change is a platform path,** never an application-workflow signature: an application workflow must not be able to change what the platform runs with.
- **Open for the owner, recommendation below:** where secret values are authored and stored. The record lists it as a gap: sops in the application repository, or held by the platform and injected.
  - **Recommended:** values never live in application repositories. They are sops-encrypted to the vps age recipient in the Kore repository beside the record (`infra/environments/vps/secrets/<suborg>/<service>.enc.yaml`) and applied by `kore` from the controller, through stdin, into the suborg's source namespace. The spec file only names the secrets. Encrypted files are also the way back after the box is lost, since a cluster-only secret vanishes with the disk.
  - **Risk the owner takes with it:** the repository is public, so every encrypted application secret is public ciphertext for as long as the age key lives; a leaked key exposes the history. A private repository or an external store would remove that.
- **Depends on that choice, so not decided here:** the naming inside a source namespace (one Secret per service, named after it, one key per declared secret name; the service's ExternalSecret reads only that Secret, and `KoreSecrets` refuses an ExternalSecret whose `remoteRef.key` is not its own service), the secret contract of the golden-path workload chart (`secretKeyRef`), and rotation (rolling the service after a value changes).

## Consequences

- Sibling services in one suborg can still read each other's Secrets, because they share a namespace; the suborg is the trust boundary.
- The live proof adds a negative check: a service in one suborg cannot read another suborg's store keys.
- The workload chart gains a secret contract only after the value-location decision.
