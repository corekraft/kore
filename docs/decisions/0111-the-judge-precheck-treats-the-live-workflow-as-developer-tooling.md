---
status: accepted
summary: The live workflow is dispatch-only, runs one chosen live suite with contents: read, no secrets and no required status, so a diff that edits it alone matches no-behaviour-change; this refines ADR 0105 and ADR 0099.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0111: The judge precheck treats the live workflow as developer tooling

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0105](0105-the-judge-precheck-treats-the-release-workflow-as-developer-tooling.md), [ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)

## Context

ADR 0099 lists the developer tooling the precheck leaves out of the behavioural
paths; ADR 0105 added the release workflow and ADR 0110 the PR declaration
workflow. `.github/workflows/live.yml` runs only on `workflow_dispatch`, takes
one `suite` input from the real `test:live:<name>` scripts, and runs it through
`nightly.sh` on a hosted runner inside the nightly's concurrency group. It
holds `contents: read`, uses no secrets, is not a required check, and changes
nothing that runs in a cluster outside its own scratch environment. The
precheck read it as behavioural, so a change to it alone could not match its
truthful `no-behaviour-change` declaration.

Owner decision: the owner accepted that developer-tooling changes merge unasked
(2026-11-14).

## Decision

- `.github/workflows/live.yml`, that exact file, is developer tooling. The
  precheck matches it with an anchored pattern and nothing broader.
- Anything else stays product: another workflow such as `deploy.yml`,
  `live.yaml` with a different extension, a nested path, a look-alike such as
  `live-deploy.yml`, and a copy under another directory.

## Consequences

- A diff that edits only this workflow matches `no-behaviour-change`.
- If the workflow later gains a push or schedule trigger, write access or
  secrets, this entry must be revisited, since the precheck would no longer
  catch it.
