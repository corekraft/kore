# AGENTS.md

Principles for working in this repository. The README explains what Kore does;
the plans and ADRs record why. Find them through
[`docs/index.md`](docs/index.md).

## Platform

- **It just works.** `kore local up` converges on the first run, from a fresh
  or an existing profile. A change to what runs in a cluster (images, chart
  values, ports, probes, scheduling, readiness) declares a safety pattern and
  merges behind a flag; live proof gates turning the flag on, not merging. Only
  `harness flag activate` turns a flag on, after a recorded live-run
  verification outcome for that flag and environment. A cluster-facing
  `no-behaviour-change` has no flag, so it needs a live run before merge. When a
  run does fail, it fails fast and names the cause, never just a timeout.
  _Audited: `flag-activation`, `harness flag audit`._
- **Desired state lives in the repository.** Catalogs, environment overlays,
  charts, and manifests are the source of truth. Kore coordinates upstream tools
  (Minikube, Helm, kubectl, OpenTofu, controllers) and never reimplements their
  reconciliation.
- **One owner per resource.** Every resource has exactly one desired-state
  owner. Don't let two tools or two components manage the same thing.
- **Pin everything.** Tools, dependencies, charts, images, providers, and policy
  bundles use exact versions. Upgrades are deliberate and recorded alongside
  their compatibility evidence.
- **Applications stay provider-neutral.** Apps know nothing about Minikube or
  any cloud; provider specifics belong to environments. Each app keeps its
  resources separate from its workload.
- **Deploy what was verified.** Images are deployed by signed digest, never by
  tag; local builds never alter the release lock. _Audited: `image-digest`._
- **Secrets never touch disk or git in plaintext.** Encrypt at rest, stream
  plaintext through stdin only. _Enforced: `secret-path`, `sops-plaintext`._
- **Audit before enforce.** New policies start in audit mode.
- **Fail closed.** Admission stays closed until every prerequisite proves
  ready. A step isn't done until its readiness checks pass.

## Safety

- **Read-only by default, explicit to mutate.** Status, validation, and
  rendering never mutate. Every mutation names its environment and configured
  context, never the current one. _Enforced: `kubectl-context`,
  `helm-context`._
- **Destruction requires consent, data destruction requires more.** Confirm
  destructive operations; retained data needs a second opt-in. Preserve these
  gates. Eval history, operation journals and the stage ledger are append-only: write
  them through their owning script, never by hand. _Enforced: `destructive`, deny
  rules. Audited: `append-only`._
- **Idempotent and resumable.** Reconciliation reruns safely and recovers from
  partial failure. Mutations are serialized per environment.
- **Validate before touching a cluster.** Schema-check config up front so
  failures are deterministic and precede any mutation. Config files stay
  JSON-compatible YAML, parsing without extra dependencies.

## Code

- **Minimal dependencies.** The CLI uses the Node standard library; a runtime
  dependency is an architectural decision.
- **Strict types.** Use the strictest practical compiler mode; work with it, not
  around it.
- **Domains own their boundaries.** Code is grouped by domain, and each domain
  exposes a small public surface. Depend on that surface, not on internals.
- **Side effects behind an interface.** External processes run through a single
  injectable runner, so all behavior is testable without a cluster.
- **Errors are actionable.** Say what's wrong and how to fix it. Handle only
  expected errors; rethrow the rest.
- **Structured output.** Commands that report state offer machine-readable
  output. Keep usage text and docs in step with command changes.
- **Formatting and lint are not up for debate.** Automated on commit; warnings
  fail the build. Format by hand with `mise run format <files>`, the pinned
  version, never a bare `npx prettier`. _Enforced: `no-verify`, post-edit feedback hook._

## Testing

- **Test first.** Write a failing test, watch it fail for the right reason, then
  write the minimum code to pass.
- **Tests describe behavior.** Name tests after the guarantee they protect and
  assert on observable outcomes, including what must _not_ happen.
- **Fast tests need no cluster.** Fake the process runner and inspect its
  commands. Clean up temporary state.
- **Live tests are opt-in.** Anything that creates or destroys a cluster runs
  only when requested, never in ordinary runs. A cluster-facing change still
  needs a live run before merge (see _It just works_).
- **Coverage only goes up.** _Enforced: `coverage-threshold`._
- **Policies have tests too,** kept beside the policies they verify.

## Changes

- **Conventional Commits,** lowercase imperative subjects. Enforced on commit.
- **Typecheck, lint, format, and test pass** before anything is committed.
  _Enforced: commit hooks, stop hook._
- **Scans pass before merge:** `mise run scan`. Ignore narrowly, with a reason.
- **Record significant decisions** as ADRs; when a step refines an earlier
  decision, record why.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `corekraft/kore`, through `gh`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root, ADRs in `docs/decisions/`. See
`docs/agents/domain.md`.

## Enforcement

_Enforced_ and _Audited_ rules are checked by `.claude/hooks/` and
`.claude/settings.json`; workflows live in `skills/`. All other rules are
guidance.
