---
status: accepted
summary: Application charts reference a stable platform-secrets store through ExternalSecret; locally SOPS with age decrypts into a protected namespace, and plaintext never enters git, disk, or Helm values.
date: 2026-09-12
last-verified: 2026-11-07
---

# ADR 0009: Deliver secrets through External Secrets from encrypted sources

Source: [`infra/plans/1-initialize.md` § Secrets](../../infra/plans/1-initialize.md#secrets)

## Context

Applications need Secret values in every environment, but the source differs:
encrypted files locally, a provider secret manager elsewhere. Plaintext in the
repository, Helm values, or logs would leak it.

## Decision

- Application resource charts create `ExternalSecret` resources that
  reference a consistently named platform store (`platform-secrets`).
- Locally, SOPS with age keeps development secrets encrypted in version
  control. `kore` decrypts them straight into a protected source namespace,
  streaming plaintext through stdin, and External Secrets Operator materializes
  application-scoped Secrets.
- Managed environments replace the store implementation with a provider secret
  manager.
- Plaintext values are never committed, written to disk, passed through Helm
  values, or printed.

## Consequences

Workloads see only a Kubernetes Secret reference and are unaffected by the
store's implementation. Rendered output, dry runs, and errors need redaction.
The rule is enforced by the `secret-path` and `sops-plaintext` hooks.
