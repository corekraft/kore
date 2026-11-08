---
status: accepted
summary: Repository scans run through pinned mise tools - TruffleHog (secrets), OSV-Scanner (npm lockfiles), Semgrep with committed rules (SAST), actionlint and zizmor (workflows), hadolint (Dockerfiles) - gated in CI at any finding, with narrow inline ignores only.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0030: Security and quality scans

## Context

Nothing scanned the repository for leaked secrets, vulnerable dependencies,
unsafe code patterns, or workflow and Dockerfile mistakes. AGENTS.md already
requires pinned tools, no new runtime dependencies, secrets that never touch
git, and audit-before-enforce.

## Decision

- **Tools live in mise, not npm.** Each scanner is pinned in `.mise.toml` and
  mirrored in `infra/catalog/versions.yaml` and `infra/catalog/compatibility.md`.
  Each is at least two weeks old when pinned.
- **One task per scanner, plus `mise run scan`.** `scan-secrets` (TruffleHog),
  `scan-vulns` (OSV-Scanner), `scan-sast` and `scan-sast-test` (Semgrep),
  `scan-workflows` (actionlint, zizmor), `scan-dockerfiles` (hadolint). CI runs
  `mise run scan` in its own job of `check.yml`; it publishes and signs nothing.
- **Secrets.** TruffleHog scans full git history and the tracked files
  (`git ls-files`, so untracked and ignored paths such as `.kore/` are never
  opened), reporting verified, unknown, and unverified results.
  `.trufflehog-exclude` also names `.kore/`, `node_modules/`, build outputs, and
  `*.enc.yaml`: SOPS ciphertext is expected, and the age recipient in
  `.sops.yaml` is a public key. Verification calls vendor APIs, so this task
  needs network.
- **Vulnerabilities.** OSV-Scanner reads each tracked npm lockfile (today
  `tools/kore/package-lock.json`; `apps/reference` has no dependencies and no
  lockfile). A test fails if a tracked lockfile is missing from the task.
  Container images are not scanned: it needs image pulls and the base-image
  digest is already pinned and reviewed under the pin-upgrade workflow.
- **SAST.** Semgrep runs only committed rules in `infra/policies/semgrep`
  (`child_process` shell use, path traversal from argv/env/request, credential
  names in logs, dynamic `RegExp`), with `--metrics=off` and no registry
  access. Rule tests sit beside the rules and run under `semgrep --test`. Test
  files are not scanned. Kubernetes and Helm manifests are covered by the OPA
  and Gatekeeper policies, so no Semgrep Kubernetes ruleset is added.
- **Workflows and Dockerfiles.** actionlint checks syntax and expressions;
  zizmor audits security (permissions, injection, pinning) offline. They
  overlap little. hadolint lints the one Dockerfile.
- **Threshold.** Every finding fails the build, at the default severity of each
  tool (zizmor: regular persona; hadolint: info and above). The repository was
  scanned clean before enforcement, so there is no baseline.
- **Ignore policy.** Never a blanket ignore. A false positive or accepted risk
  gets the narrowest entry: an inline `nosemgrep: <rule> -- <reason>` on the
  one line, or an exact path pattern with a comment in `.trufflehog-exclude`.
  Ignores for ciphertext, `.kore/`, and generated output are the only broad
  patterns.

## Not added

- **shellcheck:** no shell scripts are tracked.
- **kubeconform:** rendered charts include CRDs whose schemas need network or a
  vendored schema set; `kore validate`, OPA, and Gatekeeper tests already cover
  the manifests.
- **npm license check:** the CLI has no runtime dependencies, so little to
  check; revisit if one is added.

## Consequences

- Secret verification and OSV lookups need network, so `scan-secrets` and
  `scan-vulns` are not fully offline; the other scans are.
- New lockfiles, workflows, and Dockerfiles must be added to their task. The
  lockfile case is tested.
- Scanner upgrades follow the pin-upgrade skill; new rules can add findings.
