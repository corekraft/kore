# PersistentVolumeClaim Ownership at Admission

The Gatekeeper constraint `kore-pvc-ownership` audits PersistentVolumeClaims in
application namespaces that CloudNativePG does not own. Decided on issue
[#1666](https://github.com/corekraft/kore/issues/1666), under the v1 backup,
restore and recovery spec [#1610](https://github.com/corekraft/kore/issues/1610)
and its concept [#1481](https://github.com/corekraft/kore/issues/1481).

The reason is that v1 backs up PostgreSQL and OpenBao only. A claim that
CloudNativePG does not own holds data outside both, so no backup restores it.
This constraint makes that gap visible before any such claim is admitted.

It is behind the feature flag `pvc-ownership-admission`, which is `false` in
every overlay. With the flag off nothing is installed. It ships in **dryrun**:
it reports violations and refuses nothing. Promotion to enforce follows
[ADR 0072](../decisions/0072-constraint-promotion-procedure.md) and the
promotion steps below.

## Where it applies

Application namespaces only: the constraint matches namespaces that carry the
activation label `platform.kore.dev/activation-generation` (ADR 0054). The
platform's system namespaces are also listed as a second line of defence. A
platform namespace is never checked, so an observability or kube-system claim
is not reported.

## What it checks

A claim is CloudNativePG-owned when it carries a controller owner reference to
a `Cluster` in the `postgresql.cnpg.io` group. That is the same shape
`koresecrets` accepts for the Secrets CloudNativePG writes.

Every other PersistentVolumeClaim in an application namespace is refused in
audit. That includes:

- a claim with no owner reference;
- a claim whose CloudNativePG owner is not the controller;
- a claim owned by a `Cluster` in another API group;
- a claim owned by a workload, such as a Deployment.

A StatefulSet creates the claims of its `volumeClaimTemplates` itself, with no
CloudNativePG owner. Those claims are reported as well, because the constraint
names any claim and not only the ones a person writes by hand. The fix is to
keep the data in a PostgreSQLInstance or in OpenBao.

Each message names the claim, says that v1 backs up PostgreSQL and OpenBao only,
and names the fix. The tests live beside the policy in
`infra/policies/gatekeeper/tests/pvcownership.yaml`.

## Not covered yet

- **The ownership signal is an assumption until a live audit checks it.** The
  rule assumes CloudNativePG writes a controller owner reference to its Cluster
  on each claim it creates. No live cluster was available to the writer, so that
  is unverified. The first audit settles it: if CloudNativePG's own claims are
  reported, the assumption is wrong and the constraint must not be promoted.
- **A hand-written manifest can copy the owner reference.** Admission sees the
  manifest, not its author. The reference is visible in the manifest, and the
  audit reports the claim that copies it. This is the same kind of gap as the
  sign-in BFF label in the workload defaults.
- **Only existing and newly created or updated claims are checked.** The
  constraint matches create and update. It does not restore or move data.
- **The constraint is not in `infra/policies/gatekeeper/constraints`.** The
  `kore-policy-constraints` component installs that directory unconditionally,
  and this constraint must sit behind the flag. Because of that, `kore policy
record` and `kore policy promote` cannot find it, since they read that
  directory. Until they can, promotion is a reviewed edit, as below.

## Promotion

Do not promote until every condition holds, and promote one environment at a
time, in its own pull request, as ADR 0072 requires.

1. **The ownership assumption is verified.** A live audit of `kore-pvc-ownership`
   on the environment shows CloudNativePG's own claims admitted, and the
   violations it reports are the claims the platform must fix. Read the audit
   with:

   ```sh
   kubectl --context kore-local get korepvcownership.constraints.gatekeeper.sh kore-pvc-ownership --output json
   ```

2. **The audit is clean.** The recorded audit shows zero violations for the
   environment, no older than 14 days. Record the audit time and violation count
   in the promotion pull request, since `kore policy record` cannot read this
   constraint yet.
3. **The flag's live outcome is recorded.** `pvc-ownership-admission` turns on
   for an environment only after a recorded live-run outcome, through
   `harness flag activate` (AGENTS.md, _It just works_).
4. **The constraint is promoted by a reviewed edit.** In a pull request, change
   `enforcementAction: dryrun` to `enforcementAction: deny` in
   `infra/charts/kore-pvc-ownership/templates/korepvcownership.yaml`. Run
   `mise run test-gatekeeper` and `mise run validate`, then apply with
   `kore platform up --environment <name>`.
5. **Verify.** `kore platform status --environment <name>` must stay ready, and
   `kore app up <name> --environment <name>` must succeed for each application.

**Rollback.** Revert the promotion pull request, or set `enforcementAction` back
to `dryrun`, then run `kore platform up` and `kore platform status` as above.

This change ran no live audit: the cluster was not reachable from the writer's
environment. Its evidence is the gator suite (`mise run test-gatekeeper`), the
overlay validation (`mise run validate`), and the flag-off render, which is
byte-identical to main's.
