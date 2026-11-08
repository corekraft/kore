---
status: accepted
summary: While a component installs or its readiness is awaited, kore watches only that component's namespace read-only, and on a fatal pod state (crash loop, persistent image pull or config error, persistent scheduling failure) cancels the running command and fails with the pod, container, state, message, previous logs, and a fix hint instead of waiting out the timeout.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0035: Fail-fast readiness diagnosis

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: the fail-closed readiness gate (a step is not done until its checks pass). Failing sooner does not weaken it.

Implements: the failure half of the _It just works_ principle in [`AGENTS.md`](../../AGENTS.md): when a run does fail, it fails fast and names the cause, never just a timeout.

## Context

`helm upgrade --wait --timeout 10m` and kore's own readiness waits report only
"Progress deadline exceeded" after the full timeout. In live runs the cause was
visible within a minute: a container crash-looping with `bind: address already
in use`, and a `FailedScheduling` event ("didn't match pod anti-affinity
rules"). A failing run must fail fast and name the cause.

## Decision

- **A watcher runs beside the wait.** `withFailFast` (`platform/fail-fast.ts`)
  wraps the Helm upgrade and the readiness waits of `reconcileComponent` and
  `reconcileIfNeeded`. Every 5s it runs read-only `kubectl get pods` (and
  `get events` when a pod is unscheduled) with `--context <environment context>
  --namespace <component namespace>`. It never reads other namespaces, never
  uses `--all-namespaces`, and never mutates.
- **Scope to the release.** Pods labelled `app.kubernetes.io/instance=<release>`
  are examined; pods with no such label are also examined (not every chart sets
  it), so for those charts the watch is namespace-wide. Pods labelled for a
  different instance are ignored.
- **Fatal states.** A container or init container in `CrashLoopBackOff` with at
  least 2 restarts is fatal at once. `ImagePullBackOff`, `ErrImagePull`,
  `CreateContainerConfigError`, and a pod with a `FailedScheduling` event that
  is still unscheduled are fatal once they have persisted 60s of observation
  (the watcher's own clock, so a clearing state resets it).
  `CreateContainerConfigError` gets the grace period because a Secret another
  component creates may arrive moments later. A single restart,
  `ContainerCreating`, and a scheduling failure that clears are never fatal.
- **Cancel, then explain.** The runner gains `RunOptions.signal`;
  `ProcessRunner` sends SIGTERM when it aborts, and `withSignal` gives a block
  of commands one shared signal. On detection the signal is aborted once, kore
  waits for the command to exit, and throws `component <name> failed: pod <pod>
  container <c> <state>: <reason/message>`, the last 20 lines of
  `kubectl logs --previous` for crash loops, and a fix hint. No other wrapper
  text is added, and the retry for never-deployed releases does not run.
- **Rollback.** Helm traps SIGTERM, cancels its context, and with
  `--rollback-on-failure` rolls the release back before exiting; kore waits for
  that exit instead of killing harder. A first install left `failed` or
  `pending-install` is cleared by the existing `recoverUndeployedRelease` on
  the next run.
- **The watch is advisory.** A failed `kubectl get` (namespace not created yet,
  API blip) is retried at the next look. When the watch finds nothing, Helm or
  the readiness check still decides, with its timeout as the backstop.

## Rejected alternatives

- **Shorter timeouts.** Slow healthy installs would fail, and the cause would
  still be unnamed.
- **`kubectl wait` per pod.** It reports the end state, not why a pod is stuck.
- **Watching with `--watch` streams.** A long-lived child process is harder to
  bound and fake than a polled `get`.

## Consequences

- Failures now arrive in about a minute with the pod, container, state, and
  log lines that explain them.
- Each component wait adds a `kubectl get pods` every 5s.
- Thresholds (2 restarts, 60s grace, 5s interval) are defaults of
  `WatchOptions`; tests inject a fake clock.
