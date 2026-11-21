---
status: proposed
summary: On vps, application secrets are held by OpenBao behind the existing External Secrets contract, with one store and one secret path per suborg and the provider switch dark-launched; the unseal key is a recorded exception in its own ADR; databases get separate DDL and DML roles from CloudNativePG now, with OpenBao dynamic DDL credentials later behind their own flag.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0167: Application secrets come from OpenBao behind the platform-secrets contract, one path per suborg

Source: [issue #1484](https://github.com/corekraft/kore/issues/1484), the owner's decisions of 2026-11-20 on the secret backend (research comment by the secret-backend researcher), under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478).

Refines: [ADR 0009](0009-encrypted-secrets-through-external-secrets.md), [ADR 0024](0024-reference-app-database-access.md) (one role for DDL and DML becomes two). Builds on the ADR "A suborg is the namespace, quota and trust boundary of its services" and on the ADR "The OpenBao static seal key is a recorded exception to no plaintext on disk".

## Context

The `platform-secrets` ClusterSecretStore reads one namespace, `kore-secret-source`, and any ExternalSecret in any namespace can name any key in it. With several suborgs that lets one suborg read another's secrets. Local keeps sops with age. The owner wants vps secrets held by an open-source secret manager, not as ciphertext in the public repository. Vault has been under the BSL since 2023; OpenBao is MPL-2.0 with the Vault API. Today one generated role, `<cluster>-app`, does both schema changes (the migration hook Job) and runtime queries.

## Decision

- **The External Secrets contract is unchanged.** An application references a store through an ExternalSecret and never learns the backend. Local stays on sops with age; vps puts OpenBao behind the same contract, so no application changes.
- **OpenBao behind `platform-secrets`, dark.** A `provider` value on the secret store chooses `kubernetes` (the default, today's behaviour) or OpenBao. A dark flag, false in every overlay, switches vps after its own live outcome and `harness flag activate`. The platform's own releases keep their store; applications use per-suborg stores.
- **Pinned and small.** OpenBao and its Helm chart at exact versions, the image by digest, one standalone replica with Raft storage (so snapshots are the documented backup path), the injector and CSI sub-charts off so External Secrets stays the only path from secret to pod, and an audit device enabled in self-initialization, starting audit-only. The Raft single-voter setup through the chart is unproven and is proven in the live run.
- **One store per suborg,** a ClusterSecretStore limited by `conditions.namespaces` to that suborg's namespace. In OpenBao each suborg has its own role and policy, limited to the secret path named after the suborg. Isolation is by that path: a service cannot read another suborg's keys.
- **Unsealing is a static seal,** a recorded exception to "secrets never touch disk in plaintext", in its own ADR. Recovery shares and the key's off-box copy are the owner's.
- **No secret value in an application repository or in the public Kore repository on vps,** encrypted or not. A secret change is a platform path, never an application-workflow signature.
- **Naming inside a suborg.** The spec file lists secret names; each service's entries sit at `<suborg>/<service>` in OpenBao; the service's ExternalSecret reads only that path; and the existing `KoreSecrets` template, in audit first ([ADR 0072](0072-constraint-promotion-procedure.md)), refuses an ExternalSecret whose remote key is not under its own service. This is a guard, not a boundary: siblings share a namespace and still trust each other.
- **Entry.** A person puts a value in through a `kore` command that reads it from stdin only and writes it to OpenBao, naming its environment and context, printing nothing. No value passes through a file, an argument or a log.
- **Rotation.** Both database roles and application secrets roll their consumers through the rotation marker of [ADR 0075](0075-token-source-has-one-owner-and-rotation-rolls-consumers.md), so rotation needs no hand. Applications read the password at start ([ADR 0024](0024-reference-app-database-access.md)), so a changed Secret reaches a pod only after a restart.
- **The no-plaintext rule extends to applications.** `KoreSecrets` (a sensitive env name set as a literal) covers every suborg namespace, in audit first, and a plaintext scan of the application repository is one of the platform workflow's deterministic evals.
- **Database roles now: a DDL and a DML role.** The PostgreSQL composition declares two CloudNativePG `DatabaseRole` resources, generated and rotated, beside the existing `app` role (kept during expand). Migrations run as the DDL role and the workload as the DML role, so the runtime credential cannot change schema. A dark flag, false in every overlay, turns this on after a live outcome; the single-role contract stays until the contract step after the soak.
- **Database roles later: dynamic DDL credentials.** OpenBao's database engine issues the DDL credential on demand, for minutes, behind its own dark flag after the role split has soaked. The DML role stays static until the workload mounts credentials as files or restarts on rotation, because a sealed OpenBao outliving a runtime TTL would make logins fail.

## Open for the owner

- **How a new suborg gets its OpenBao role and policy** with no human approval. OpenBao's self-initialization runs once, so something else must apply later desired state. The recommendation is to avoid per-suborg OpenBao configuration: each suborg's store authenticates with a reader ServiceAccount in the suborg's namespace to one Kubernetes-auth role, and one templated policy limits the caller to the path named after its own namespace, so self-initialization stays the only owner of OpenBao configuration. That reads the owner's "per-suborg roles and policies" as per-suborg effect, not per-suborg objects, which the owner has not confirmed. It is unverified at the pinned versions; the fallback is OpenTofu's `vault` provider applying a role and policy per suborg. A proof ticket decides it in a live run.

## Consequences

- OpenBao's storage becomes the only copy of vps application secret values, so "snapshot plus unseal key" replace "encrypted files" as the way back after the box is lost. The snapshot schedule, target and drill belong to the backup decision, and an application whose values live only in OpenBao does not go public before an off-host snapshot exists (decision 4 of the interview record).
- Sibling services in one suborg can still read each other's Secrets, because they share a namespace; the suborg is the trust boundary.
- Values land in Kubernetes Secrets once External Secrets materialises them, protected by the k3s Secret-encryption key on the same disks, as they already are locally.
- The live proof adds negative checks: a service in one suborg cannot read another suborg's keys; after a restart OpenBao unseals without a hand; the runtime role cannot change schema.
- If OpenBao stays sealed, running applications keep working from the materialised Secrets; refresh, rotation and new applications stop (unverified External Secrets behaviour; proven in the live run).
