---
status: active
summary: Replace loose exported functions with one cohesive class per domain responsibility, constructed with its repository and runner, and enforce the shape with size and class lint rules.
last-verified: 2026-11-08
---

# Cohesive Domain Classes Plan

## Purpose

`tools/kore/src` is about 124 exported or top-level functions and 8 classes.
Almost every exported function takes the same leading arguments,
`(repository, runner, ...)`. For example, `clusterUp`, `clusterStop`,
`clusterDestroy` and `clusterStatus` all take them, and so do `platformUp`,
`platformStatus`, `appUp`, `syncLocalSecrets` and `installLocalTrust`. A
domain's state and behaviour are spread across loose functions. Each one
re-threads the same dependencies, and helpers are private only by convention.

The lint ratchet from `build/lint-size-rules` caps functions at 70 lines and
files at 300. Meeting those caps with free functions spreads one
responsibility across more modules. The right home for those steps is a class
that owns its collaborators: public methods are the domain's operations, and
private methods are the steps.

This plan records the target shape, so the size refactors land as raw
material for classes rather than as a permanent function sprawl.

## Principles

- **One class per responsibility.** Example classes are `Cluster`, `Platform`,
  `Application`, `LocalEnvironment`, `Tunnel`, `SecretSync`, `LocalTrust`,
  `LocalImageSigner`, `ImageLock`, `EnvironmentLock`, `Journal`,
  `RepositoryValidator` and `Doctor`. Name each one after the domain noun, not
  `*Service` or `*Manager`.
- **Constructor injection, no framework.** Dependencies go in through the
  constructor, usually `Repository` and `Runner`. They are held as
  `private readonly` fields. The injectable runner stays the single seam for
  side effects (AGENTS.md), and tests construct the class with
  `RecordingRunner` or a fake.
- **Composition over inheritance.** No base classes beyond the existing error
  types. Collaborating classes are passed in, not extended. For example,
  `Platform` takes an `EnvironmentLock` and a `Cluster` where it needs them.
- **Pure helpers stay functions.** Code that needs no dependencies stays a
  module-level function or a small value object. This covers argument
  builders, parsers and validators over plain data. A class earns its place by
  holding collaborators or state, not by wrapping one function.
- **Public surface is the class and its types.** Each domain's `index.ts`
  exports its classes and types, not their steps. Other domains import only
  through `index.js`, as today.
- **The CLI is the composition root.** `cli/` builds the classes once per
  invocation from the loaded repository and the process runner. Command
  handlers call methods on them. No other module constructs a dependency it
  could receive.
- **Behaviour-preserving, test first.** Each conversion first pins the current
  observable behaviour: runner commands, outputs and errors. Then it moves code
  under existing and new specs without changing them.

## Target Rules

These are added to `tools/kore/.oxlintrc.json` as each step makes them pass.
They are never added as warnings, because lint runs with `--deny-warnings`.

| Rule                     | Target         | Why                                                                       |
| ------------------------ | -------------- | ------------------------------------------------------------------------- |
| `max-lines-per-function` | 70             | Methods stay one step each.                                               |
| `max-lines`              | 300            | One class, with its private helpers, per file.                            |
| `max-classes-per-file`   | 1 (production) | One responsibility per file.                                              |
| `class-methods-use-this` | error          | A method that ignores `this` is a pure helper and should be a function.   |
| `max-params`             | 4, then 3      | Dependencies move to the constructor. Methods take only operation inputs. |
| `complexity`             | 10             | Same target as the size ratchet.                                          |
| `max-statements`         | 25             | Same target.                                                              |
| `import/no-cycle`        | error          | Already on. Composition must not introduce cycles.                        |

## Step 1: Decide the Shape

### Work

- Write an ADR (`write-adr`) that records the decision. It covers: classes
  per responsibility, constructor injection of `Repository` and `Runner`, no
  inheritance, pure helpers as functions, and the CLI as composition root. It
  refines `0001-kore-typescript-cli.md`.
- Add one line to AGENTS.md under "Code", in the existing style: "Domains
  expose cohesive classes; dependencies arrive through the constructor;
  methods stay small."

### Exit Criteria

- The ADR is accepted and listed in `docs/index.md`.
- `mise run kb-check` passes.

## Step 2: Pilot One Domain

### Work

- Convert `cluster/` to a `Cluster` class constructed with
  `(repository, runner)`. It has `up`, `stop`, `destroy` and `status`.
  `assertExpectedCluster` becomes a private method or a pure function,
  whichever needs no `this`.
- Update the `cli/` handlers and `local/` callers to construct and call it.
- Record anything the pilot changes about the conventions back into the ADR
  before converting more domains.

### Exit Criteria

- `cluster/index.ts` exports `Cluster`, `ClusterUnavailableError` and types
  only.
- The existing cluster specs pass, rewritten only where they called the old
  functions.
- `max-classes-per-file: 1` and `class-methods-use-this` pass for `cluster/`.
  Scope them with an `overrides` entry until the step that enables them
  everywhere.

## Step 3: Convert the Remaining Domains

Convert the leaves first, so every class can receive already-converted
collaborators. Domains with no shared files can run in parallel herdr sessions,
one worktree each.

1. `runtime/`: `EnvironmentLock` (`withEnvironmentLock`) and `Journal`
   (`withJournal`, `readJournal`, `summarizeOperations`). `ProcessRunner`,
   `RecordingRunner` and `JournalingRunner` are already classes. Split them to
   one per file.
2. `config/`: `loadRepository` stays a function that returns the `Repository`
   value. `RepositoryValidator` holds the table-driven checks.
3. `images/` and `security/`: `ImageLock`, `LocalImageSigner`, `SecretSync`
   and `LocalTrust`. Secrets keep streaming through stdin only.
4. `platform/`: `Platform`, with `bootstrap`, `up`, `stop`, `destroy`,
   `status` and `render`. Readiness waiting moves to a separate collaborator
   such as `ReadinessWaiter`, if it is used outside `Platform`.
5. `app/`: `Application`, constructed per app name or with the name as a
   method argument. Decide which in the pilot ADR.
6. `local/`, `tunnel/` and `diagnostics/`: `LocalEnvironment` composes
   `Cluster`, `Platform`, `Application`, `SecretSync` and `LocalTrust`. Also
   `Tunnel` and `Doctor`.
7. `cli/`: command handlers receive constructed domain objects from a single
   composition function.

### Exit Criteria

- Each converted domain exports classes and types only, except for pure
  helpers that need no dependencies.
- Coverage does not drop (`coverage-threshold`).
- `kore` behaviour is unchanged: the CLI dispatch specs and the opt-in
  integration specs pass.

## Step 4: Enforce

### Work

- Enable `max-classes-per-file: 1` and `class-methods-use-this` for all
  production files.
- Lower `max-params` to 4, then to 3.
- Lower `complexity` to 10 and `max-statements` to 25.
- Lower each threshold in the same commit as the refactor that earns it.

### Exit Criteria

- `npm run lint` passes with every rule in Target Rules at its target value.
- AGENTS.md names the rules as _Enforced_.

## Not Planned

- A dependency-injection container, decorators or reflection metadata. The
  composition root is plain code.
- Inheritance hierarchies or abstract base classes for domains.
- Wrapping pure data transforms in classes for uniformity.
- Changing CLI behaviour, output or flags. This plan is internal structure
  only.

## Results

Not started. The size-ratchet refactors on `build/lint-size-rules`
(70 lines per function, 300 lines per file) are in flight. They split long
functions into named module-level steps, and Step 3 turns those steps into
private methods.
