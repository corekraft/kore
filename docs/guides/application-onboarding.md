# Application Onboarding

How an application joins the platform. The reference application in
[`apps/reference`](../../apps/reference) is the worked example. Commands are
written as `kore ...` (see the [operator guide](operator.md)).

## The contract

An application is provider-neutral: it knows nothing about Minikube or a cloud.
It ships two Helm charts, kept separate so data outlives the workload
([ADR 0003](../decisions/0003-separate-claims-and-retain-data.md)):

- `resources` chart: its claims (for example a PostgreSQL claim) and other
  long-lived resources.
- `workload` chart: Deployments, Services, ServiceAccounts, routes.

Rules the platform enforces:

- **Signed digest only.** The workload image is deployed by digest from the
  release image lock; locally, `kore app up` builds, publishes, signs, verifies,
  and deploys the exact digest. A tag or an unsigned digest is not admitted.
- **Identity.** Each workload runs under its own ServiceAccount, never the
  namespace default (audited by `KoreWorkloadIdentity`).
- **Telemetry.** Send OTLP only to the environment's Collector endpoint
  (`telemetry.otlpEndpoint` in the overlay).
- **Secrets.** Reference them through `ExternalSecret`; no literal credential in
  env vars or values (audited by `KoreSecrets`).
- **Storage.** Persistent claims carry `platform.kore.dev/retention: Retain` on
  `kore-retained`, or `Delete` on `kore-standard`.
- **Namespace.** `kore app up` creates the namespace, enrolls it in the ambient
  mesh and image admission, and reads the label back; do not create it by hand.

`kore validate --environment local` checks that every application has separate
resources and workload charts with no provider-specific references.

## Steps

1. Copy the layout of `apps/reference` (`charts/resources`, `charts/workload`,
   a Dockerfile).
2. Register the application and its image in the catalog and release image lock
   (see `infra/catalog` and `skills/pin-upgrade/SKILL.md`). **Gap:** there is no
   `kore` command that scaffolds an application or edits the lock; do it by
   hand and let `kore validate` check it.
3. `kore validate --environment local`.
4. `kore local up --environment local` (or, with the platform already up,
   `kore app up <name> --environment local`).
5. `kore app status <name> --environment local` (add `--json` for scripts).

## Removing

`kore app down <name> --environment local` uninstalls only the workload release
and lists the retained claims and volumes that remain. Data is destroyed only by
`kore local down --prune --purge-data`.

## Admission gate

`kore app up` is refused until the platform admission gate is open for the
repository's generation; the refusal names the state and the remedy
([ADR 0054](../decisions/0054-application-admission-gate-closed-at-foundation.md)).
