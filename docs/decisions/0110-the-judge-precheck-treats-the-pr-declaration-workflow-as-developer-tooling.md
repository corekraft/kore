---
status: accepted
summary: The pr-declaration workflow takes only the PR body as input and builds the harness from the checkout with contents: read, no secrets and no required status, so a diff that edits it alone matches no-behaviour-change; this refines ADR 0105 and ADR 0099.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0110: The judge precheck treats the PR declaration workflow as developer tooling

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0105](0105-the-judge-precheck-treats-the-release-workflow-as-developer-tooling.md), [ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)

## Context

ADR 0099 lists the developer tooling the precheck leaves out of the behavioural
paths, and ADR 0105 added the release workflow. The workflow
`.github/workflows/pr-declaration.yml` is an audit job that checks a pull
request body has exactly one valid `Safety pattern` line. Its only input is the
PR body. It checks out the repository, builds the harness from that checkout
and runs it, so it executes the pull request's own harness code. It runs with
`contents: read`, uses no secrets, is not a required check, and cannot change
what runs in a cluster. The precheck read it as behavioural, so PR #636
could not pass with its truthful `no-behaviour-change` declaration.

## Decision

- `.github/workflows/pr-declaration.yml`, that exact file, is developer tooling.
  The precheck matches it with an anchored pattern and nothing broader.
- Anything else stays product: another workflow such as `deploy.yml`, a nested
  path, a copy under another directory, and `pr-declaration.yaml` with a
  different extension.

## Consequences

- A diff that edits only this workflow matches `no-behaviour-change`.
- If the job later gains write access, secrets or a required status, this
  entry must be revisited, since the precheck would no longer catch it.
