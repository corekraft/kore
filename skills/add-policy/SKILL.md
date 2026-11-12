---
name: add-policy
description: Use when adding or changing an OPA/Rego or Gatekeeper policy under infra/policies.
---

# Add a policy

New policies start in audit mode (`AGENTS.md`: audit before enforce).

## Checklist

1. **Test first.** Add failing tests to the `*.spec.rego` file beside the policy, covering the allowed and the denied case. Bundles live in `infra/policies/opa/bundles/v1/`.
2. **Implement** the rule in the sibling `policy.rego`, using `import rego.v1` and default-deny style as the existing rules do.
3. **Audit mode.** Ship any cluster-enforced constraint with an audit enforcement action. Then answer: what would it deny on the current tree? What evidence promotes it to enforce? Record both in the change.
4. **Run** `mise run test-opa` and `mise run validate`.
5. **Record** a significant policy decision as an ADR (see the `write-adr` skill).

Step 4 is a tool. Steps 1 to 3 and 5 are judgement: what a policy should deny and what evidence promotes it to enforce are design decisions.
