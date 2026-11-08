---
status: accepted
summary: kore data export dumps retained CloudNativePG databases with pg_dump, encrypts the stream with age to the .sops.yaml recipient, and records a digest manifest that cluster destroy trusts; kore data restore loads it into a fresh profile.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0029: Local export and restore of retained data

Source: [`infra/plans/2-implementation.md` § Step 10](../../infra/plans/2-implementation.md)

Refines: [ADR 0003](0003-separate-claims-and-retain-data.md) (retained data needs a recoverable path before destroy is safe).

## Context

`cluster destroy` accepts an unreachable profile only when a verified export
exists, but nothing produced one, and the check trusted any `.sha256` file next
to any file, including a plaintext dump. The 2026-11-08 decision limits Step 10
to a local proof: export the CloudNativePG database and restore it into a fresh
profile. Scheduled backups and object storage wait for the managed environment.

## Decision

- **Upstream tools do the work.** `kubectl exec` runs `pg_dump --format=plain`
  in the CloudNativePG primary; `kubectl exec -i` runs `psql
--single-transaction -v ON_ERROR_STOP=1` to load. Kore streams between them
  and `age` through the injectable runner.
- **Exports are never plaintext.** The dump goes from the runner into
  `age --armor --recipient <recipient>` in memory and only ciphertext is
  written, mode 0600, under the gitignored `.kore/exports/<environment>/`.
  Armored output keeps the artifact text-safe for the string-based runner.
- **The recipient is read from `.sops.yaml`,** the creation rule whose
  `path_regex` names the environment, so there is one owner of the local
  recipient. The placeholder `AGE-RECIPIENT-MUST-BE-CONFIGURED` or a malformed
  value fails before any cluster contact.
- **Restore never reads keys.** It passes `--identity` (or `SOPS_AGE_KEY_FILE`)
  to `age --decrypt`; age reads the file. Without either it fails with the fix.
- **A manifest proves the export.** `<artifact>.manifest.json` records version,
  environment, timestamp, recipient, contents (namespace, cluster, database,
  format), and the artifact file, SHA-256, and size. `hasVerifiedExport` is true
  only when a manifest names this environment and its artifact still matches.
  A bare checksum sidecar no longer counts.
- **Restore targets a fresh profile.** It verifies the digest, finds the
  manifest's cluster by the retention label, counts user tables, and refuses a
  non-empty database unless `--overwrite-data --yes` is given, which drops and
  recreates schema `public` in the same transaction as the load.
- **Fail closed on uncovered volumes.** Export refuses while retained
  PersistentVolumeClaims exist that CloudNativePG does not own, because the
  logical dump cannot recover them.

## Consequences

- The dump passes through process memory and the runner's captured string, which
  is acceptable for local data volumes and not for a managed environment.
- `pg_dump` plain format restores to the same major PostgreSQL line; roles are
  expected to exist from the same composition.
- Retained volumes that are not databases have no export path yet; destroying
  them stays behind `--purge-data`.
- Live evidence (export, destroy, fresh `kore local up`, restore) still needs a
  cluster and the user's age recipient.
