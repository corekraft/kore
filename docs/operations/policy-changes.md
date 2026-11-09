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
constraint at a time (a pull request per family):

1. **Audit.** Read the violations on the live cluster:
   `kubectl --context kore-local get <kind> <name> --output yaml` (for example
   `korerbac kore-rbac`) and read `.status.violations`.
2. **Clean or recorded.** Promotion needs zero violations outside the exempt
   namespaces, or each one recorded as a reviewed exception in the pull request.
3. **Promote.** Change `enforcementAction` to `deny` in
   [`infra/policies/gatekeeper/constraints`](../../infra/policies/gatekeeper/constraints)
   and run `kore platform up --environment local`.
4. **Verify.** `kore platform status --environment local` must stay ready;
   then `kore app up <name> --environment local` for each application.

Image admission follows the same order with a different lever: `trust.mode:
warn` admits with a warning, `enforce` denies
([ADR 0032](../decisions/0032-application-namespace-image-admission.md)).
Local is on `enforce`; a new policy starts on `warn`.

**Gap:** Gatekeeper promotion has no `kore` command and no live proof that every
constraint is clean (plan Step 9, "Promote constraints individually"); the OPA
authorizer has no audit mode.

## Rollback

A policy change that blocks legitimate work is reverted, not bypassed:

1. Revert the pull request (`git revert`), or set the constraint back to
   `enforcementAction: dryrun` / `trust.mode: warn` in a new change.
2. `kore platform up --environment local` applies it (the release hash changes,
   so the release or manifest is reconciled).
3. `kore platform status --environment local` confirms readiness.

The offline suites above must pass on the reverted tree. The OPA authorizer
fails closed when unavailable, so a broken bundle denies traffic until the
chart is reverted.
**Gap:** no live test exercises a policy rollback end to end (plan Step 15, exit
criterion "Policy and identity changes have tested rollback procedures").

## Emergency exemptions

**Gap:** no time-bounded or audited exemption mechanism exists. The levers are
repository changes, which are reviewed and journaled:

- Add the namespace to a constraint's `exemptNamespaces` (Gatekeeper), with the
  reason and the removal in the same pull request or a tracked follow-up.
- List a namespace under `enrollmentExemptions` in the environment overlay with
  its reason (image admission); `kore validate` requires a non-empty reason.
- Set `trust.mode: warn` for the image policy (see
  [signing and keys](signing-and-keys.md#break-glass-recovery)).

Never edit constraints or webhook configurations with `kubectl`: the next
`kore platform up` reverts a managed object, and the edit is in no journal.
