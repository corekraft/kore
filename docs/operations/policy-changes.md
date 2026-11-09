# Policy Change Review, Promotion, Rollback, and Exemptions

Two policy systems act on a cluster: Gatekeeper constraints
([ADR 0017](../decisions/0017-gatekeeper-policy-families-audit-first.md)) and the
OPA authorizer bundle behind Istio
([ADR 0014](../decisions/0014-native-identity-before-opa.md),
[ADR 0018](../decisions/0018-opa-bundle-chart-single-source.md)); image
admission is a third, owned by Sigstore Policy Controller
([ADR 0032](../decisions/0032-application-namespace-image-admission.md)).
Commands are written as `kore ...` (see the [operator guide](../guides/operator.md)).

## Review

A policy change is a pull request that changes one of:

- `infra/policies/gatekeeper/templates` and `constraints` with its suite in
  `infra/policies/gatekeeper/tests`;
- `infra/policies/opa/bundles/v1` (`policy.rego` with `policy.spec.rego`);
- the `trust` block of an environment's `image-policy` values.

The reviewer checks that a test fails without the change, that a deny case
exists for what is being restricted, and that the exemption list is not widened
without a reason in the pull request. Run, before commit:

```sh
mise run test-gatekeeper
mise run test-opa
mise run validate
```

`kore validate --environment <name>` checks the overlay's `trust` block (exact
identities only). The `add-policy` skill in `skills/add-policy/SKILL.md`
describes the workflow.

## Audit before enforce

Every Gatekeeper constraint ships with `enforcementAction: dryrun`. Promote one
constraint at a time (a pull request per constraint). The commands edit the
repository only; they never touch a cluster
([ADR 0072](../decisions/0072-constraint-promotion-procedure.md)).

1. **Audit.** Read the constraint's audit on the live cluster and record it:

   ```sh
   kubectl --context kore-local get koreworkloadidentity.constraints.gatekeeper.sh kore-workload-identity --output json \
     | kore policy record kore-workload-identity --environment local --audit -
   ```

   Only the audit time and violation count are kept in
   `infra/policies/gatekeeper/promotions/<constraint>.json`.

2. **Promote.** `kore policy promote kore-workload-identity --environment local`
   changes that one constraint from `dryrun` to `deny`. It refuses, changing
   nothing, when the record is missing, shows any violation, has no evidence for
   the environment, or is older than 14 days (audit again). Fix the platform
   rather than record a reviewed exception; the platform and its controllers
   must comply.
3. **Review and apply.** Commit the two changed files in a pull request;
   `kore validate --environment local` applies the same evidence checks. Then
   `kore platform up --environment local`.
4. **Verify.** `kore platform status --environment local` must stay ready;
   then `kore app up <name> --environment local` for each application.

Image admission follows the same order with a different lever: `trust.mode:
warn` admits with a warning, `enforce` denies
([ADR 0032](../decisions/0032-application-namespace-image-admission.md)).
Local is on `enforce`; a new policy starts on `warn`.

The offline tests prove refusal with violations, with stale or missing
evidence, and the rollback. The live round trip is opt-in:
`npm --prefix tools/kore run test:integration:policy` promotes
`kore-workload-identity`, proves a default-ServiceAccount workload is rejected,
rolls back, and proves it is admitted again. It has not run live yet, and no
committed constraint is promoted.

**Gap:** no live proof yet that every constraint audits clean; the OPA
authorizer has no audit mode.

## Rollback

A policy change that blocks legitimate work is reverted, not bypassed:

1. `kore policy rollback <constraint> --environment local` sets one constraint
   back to `dryrun` and keeps its evidence (or `git revert` the promotion pull
   request, or set `trust.mode: warn` for image admission).
2. `kore platform up --environment local` applies it (the release hash changes,
   so the release or manifest is reconciled).
3. `kore platform status --environment local` confirms readiness.

The offline suites above must pass on the reverted tree. The OPA authorizer
fails closed when unavailable, so a broken bundle denies traffic until the
chart is reverted.
The Gatekeeper rollback is tested offline and by the live round trip above, which
has not run yet (plan Step 15, "Policy and identity changes have tested rollback
procedures"). The OPA bundle rollback is still untested live.

## Emergency exemptions

**Gap:** no time-bounded or audited exemption mechanism exists. The levers are
repository changes, which are reviewed and journaled:

- Add the namespace to a constraint's `exemptNamespaces` (Gatekeeper), with the
  reason and the removal in the same pull request or a tracked follow-up.
- List a namespace under `enrollmentExemptions` in the environment overlay with
  its reason (image admission); `kore validate` requires a non-empty reason.
- Set `trust.mode: warn` for the image policy (see
  [signing and keys](signing-and-keys.md#break-glass-recovery)).

Never edit constraints or webhook configurations by hand: the next
`kore platform up` reverts a managed object, and the edit is in no journal.
