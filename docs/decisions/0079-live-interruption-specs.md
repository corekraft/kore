---
status: accepted
summary: Interrupted image promotion, interrupted Helm upgrades, partial platform up, and a partially closed trust loop are proven by opt-in live specs that kill one real command through an injectable interrupting runner and then rerun kore's own recovery path.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0079: Prove interruption recovery with killed commands, live

Source: [`infra/plans/2-implementation.md` § Step 14](../../infra/plans/2-implementation.md#step-14-portability-and-resilience-validation)

Refines: [ADR 0004](0004-fail-closed-application-admission-gate.md) (a failed
or interrupted run leaves the gate closed) and
[ADR 0028](0028-image-trust-authority.md) (the trust loop between the signer,
Policy Controller and the registry).

## Context

Offline fakes proved that Helm recovery and resumed reconciliation work
(`platform.helm-recovery.spec.ts`, `platform.resilience-converge.spec.ts`), but
no run had killed a real build, signature, push, or `helm upgrade`, and nothing
had left the trust loop half closed and recovered it.

## Decision

- **`interruptingRunner` (runtime) wraps the single injectable Runner** and
  terminates the first N matching commands after a delay, as a Ctrl-C or host
  crash would. Later calls pass through, so the same wrapper can run the
  recovery. It adds no process handling: it uses the runner's `signal`.
- **Four opt-in live specs, each with its own script and the environment
  lock:** `test:integration:promotion` (kill `minikube image push`, then
  `cosign sign`; the release lock, gate and running workload are unchanged and a
  rerun converges), `test:integration:helm-interrupt` (kill every
  `helm upgrade` of `opa-authorizer`, through `reconcileComponent` and through
  `platformUp`; the gate stays closed and a plain rerun converges),
  and `test:integration:trust-loop` (delete the policy-controller key Secret or
  corrupt the registry CA ConfigMap with the gate closed; one `platformUp`
  repairs both and opens the gate).
- **No Secret value is read.** The trust-loop spec lists key names only.

## Consequences

- The specs are written, not yet run: the plan items stay open until a live run
  passes. A kill that lands after the command finished fails the spec with a
  "rerun" message rather than passing vacuously.
