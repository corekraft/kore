---
status: accepted
summary: After minikube starts a profile kore waits, bounded, for the API server's /readyz and a Ready node before any apply, and one runner layer retries mutating kubectl commands (apply, patch, label, annotate) that fail with a transient stderr, with capped exponential backoff and stdin replayed in memory; validation, authorization, and webhook denials fail at once, and exhausted retries name the cause.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0065: Restart readiness and transient kubectl retry

Source: [`infra/plans/2-implementation.md`](../../infra/plans/2-implementation.md)

Refines: [ADR 0035](0035-fail-fast-readiness-diagnosis.md). Failing fast still holds for permanent errors; only a provably transient API-server or webhook outage is waited out, within a bound, and then named.

Implements: the _It just works_ principle in [`AGENTS.md`](../../AGENTS.md): `kore local up` converges on the first run from a stopped profile.

## Context

Right after minikube restarted a stopped profile, `kubectl apply --server-side
--filename=-` (registry credentials) failed with "context deadline exceeded
(Client.Timeout ...)" / "error validating STDIN ... Please retry" while the API
server and the cert-manager, policy-controller and gatekeeper webhooks were
still settling. A minute later everything was Ready, and kore printed no cause.

## Decision

- **Wait before applying.** `clusterUp` calls `waitForClusterReady`
  (`cluster/readiness.ts`) after `minikube start`: `kubectl get --raw /readyz`
  and then a Ready node, polled with the configured context for at most 180s.
  On timeout it fails naming what was not ready and that nothing was applied.
- **Retry transient failures in one place.** `withTransientRetry`
  (`runtime/retry.ts`) wraps the CLI's runner. It retries only `kubectl apply`,
  `patch`, `label` and `annotate` (repeating desired state), up to 6 attempts
  with 2s, 4s, 8s, 16s, 30s backoff. Reads are never retried, so status and
  doctor on a stopped cluster still fail at once.
- **Classify by stderr.** Transient: client timeout, context deadline exceeded,
  "Please retry", "the server is currently unable to handle the request",
  ServiceUnavailable/Timeout/TooManyRequests, a webhook call refused or without
  endpoints, etcdserver leader changed or request timed out, TLS handshake or
  i/o timeout, connection refused or reset. Anything that also matches a real
  answer (Forbidden, Unauthorized, invalid, unknown field, NotFound,
  AlreadyExists, Conflict, BadRequest, "denied the request") is never retried.
- **Replay stdin in memory.** `input` is passed again unchanged, so secrets
  keep streaming through stdin and never touch disk or logs.
- **Say what happened.** Each retry logs one line naming the command and the
  first line of stderr; the final error names the cause, the attempts and
  backoff spent, and that the API server or an admission webhook is not ready.

## Consequences

- A restart converges without a manual rerun; a genuinely broken cluster fails
  after about a minute with the cause.
- The classifier is a list of observed messages; a new transient message is a
  one-line addition with a test.
