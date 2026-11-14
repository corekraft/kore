---
status: accepted
summary: The main ruleset JSON under .github/rulesets governs which merges are allowed, never what a user or cluster runs, so a diff that edits it alone matches no-behaviour-change; this refines ADR 0099.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0108: The judge precheck treats the ruleset files as developer tooling

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)

## Context

ADR 0099 lists the developer tooling the precheck leaves out of the behavioural
paths, and says everything else is product. The GitHub ruleset in
`.github/rulesets/main.json` sets which checks a merge to `main` must pass. It
decides what builds, tests, guards and ships the code. It never decides what a
user of `kore` or a cluster runs. PR #595 was held by the precheck as
behavioural over a change to that file alone, so a tooling-only change to the
ruleset could not pass with its truthful `no-behaviour-change` declaration. The
owner decided that the ruleset is developer tooling, for the same reason as the
release workflow in [ADR 0105](0105-the-judge-precheck-treats-the-release-workflow-as-developer-tooling.md).

## Decision

- `.github/rulesets/<name>.json`, one JSON file directly in that directory, is
  developer tooling. The precheck matches that shape with an anchored pattern,
  and nothing broader.
- Anything else stays product: a ruleset in another format (`main.yaml`), a file
  in a nested directory, a JSON file outside `.github/rulesets`, and a file in
  `infra/rulesets`.

## Consequences

- A diff that edits a ruleset JSON file alone matches `no-behaviour-change` with
  its truthful declaration, and the judge no longer has to read it as product.
- Merging a ruleset change changes nothing live. The ruleset applied to the
  repository changes only when the owner approves a harness ruleset sync, so
  that step stays with the owner.
- The precheck no longer flags a change to which checks a merge requires. The
  judge's reading of the diff is the only backstop for that.
