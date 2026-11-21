---
status: proposed
summary: Application secrets are read through External Secrets from one store per suborg, limited to that suborg, with the External Secrets contract settled; on vps the backend behind the stores is an open-source secret manager (OpenBao is the lead) pending research, and no secret value, encrypted or not, lives in an application repository or in the public Kore repository.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: Each suborg reads its own secret store, and the vps backend is pending research

Source: [issue #1484](https://github.com/corekraft/kore/issues/1484), under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478) (the app secrets gap, decisions 12 and 14, and the owner's answer of 2026-11-20).

Refines: [ADR 0009](0009-encrypted-secrets-through-external-secrets.md). Builds on the suborg layout in the ADR "A suborg is the namespace, quota and trust boundary of its services".

## Context

The `platform-secrets` ClusterSecretStore reads one namespace, `kore-secret-source`, and any ExternalSecret in any namespace can name any key in it. With several suborgs that lets one suborg read another's secrets. Local keeps sops with age, decrypted by `kore` through stdin ([ADR 0009](0009-encrypted-secrets-through-external-secrets.md)). The owner decided on 2026-11-20 that vps application secrets come from an open-source secret manager that can inject them, not from ciphertext in the public repository. Vault has been under the BSL since 2023, so the candidate is OpenBao (MPL-2.0, Vault-compatible API). Unsealing on one node with no cloud KMS across the weekly reboot is the open question; research with options and a recommendation is running.

## Decision

- **The External Secrets contract is settled.** An application's resources reference a store through an ExternalSecret and never learn the backend ([ADR 0009](0009-encrypted-secrets-through-external-secrets.md)). Local keeps its backend; vps may put another behind the same contract with no application change.
- **One store per suborg,** a ClusterSecretStore limited by `conditions.namespaces` to that suborg's namespace, created by the Organization composition. Its backend access is limited to that suborg too: on local its own source namespace, on vps its own path and a role bound to the suborg's namespace in the secret manager. This uses upstream External Secrets and reimplements nothing. It replaces the shared store for applications; the platform's own releases keep `platform-secrets`.
- **No secret value lives in an application repository or in the public Kore repository on vps,** encrypted or not. A secret change is a platform path, never an application-workflow signature: an application workflow must not be able to change what the platform runs with.
- **The no-plaintext rule extends to applications.** The existing `KoreSecrets` constraint (a sensitive env name set as a literal) covers every suborg namespace, in audit first, promoted by [ADR 0072](0072-constraint-promotion-procedure.md). A plaintext scan of the application repository is one of the platform workflow's deterministic evals, and a hit refuses the attestation.
- **Pending research, so not decided here:** the vps backend (OpenBao is the lead) and how it is unsealed after a reboot; how a person or the platform enters a value; per-service naming inside a suborg's path, the ExternalSecret rule that keeps a service from reading a sibling's entry, the workload chart's `secretKeyRef` contract and rotation; and how the backend's data is backed up and restored with the box, which the backup decision shares.

## Consequences

- Sibling services in one suborg can still read each other's Secrets, because they share a namespace; the suborg is the trust boundary.
- The live proof adds a negative check: a service in one suborg cannot read another suborg's store keys, whatever the backend.
- Tearing a suborg down removes its store and, with the data opt-in, its entries in the backend.
- The workload chart gains a secret contract only once the backend research is decided; tickets for the backend, naming and rotation are filed then.
