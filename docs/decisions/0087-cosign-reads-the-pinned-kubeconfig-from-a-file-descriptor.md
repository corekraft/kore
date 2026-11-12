---
status: accepted
summary: Kore feeds the pinned kubeconfig to cosign from memory as KUBECONFIG=/dev/fd/N, so embedded k3d credentials never touch disk and the refusal of embedded credentials is no longer needed.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0087: Cosign reads the pinned kubeconfig from a file descriptor

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 3](../../infra/plans/9-k3d-local-cluster.md#step-3-images-and-registry-trust)

Refines: ADR 0015

## Context

ADR 0015 pins cosign to the configured context with a temporary kubeconfig and
refuses any kubeconfig that embeds credentials, so they are never copied to
disk. `kubectl config view` redacts embedded data, and k3d writes client
certificate data inline, so on k3d the check refused the context and the
redacted copy could not have worked anyway (live run 6).

## Decision

The rule holds: credentials never touch disk. Kore reads the minified kubeconfig
with `--raw` into memory and the runner's `kubeconfig` option hands it to each
child as `KUBECONFIG=/dev/fd/N` through a pipe (a bash process substitution
that survives `exec`). No temporary kubeconfig file or directory exists. The
refusal of embedded credentials is dropped, because embedding is now safe.
Cosign has no key-generation path that avoids a file for `cosign.pub`, so a
scratch directory remains for that public output only.

Proven live on macOS with cosign 3.1.3 and kubectl: both read the descriptor,
and `cosign generate-key-pair k8s://...` created its Secret through it. Each
cosign call gets its own descriptor, so a client that read the kubeconfig more
than once would still work per call.

## Consequences

- A tool that cannot read a pipe cannot be used with the `kubeconfig` option;
  there is no temporary-file fallback.
- The kubeconfig is visible to the same user's process list only as a
  descriptor number, never in arguments or the environment.
