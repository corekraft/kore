# Contributor Guide

How to change this repository. The rules are in [`AGENTS.md`](../../AGENTS.md);
this page is the short path through them.

## Set up

```sh
mise install
mise exec -- npm --prefix tools/kore install
```

## The loop

1. **Find the reasons first.** Start at [`docs/index.md`](../index.md); read the
   plan step and the ADRs it links.
2. **Write a failing test**, watch it fail for the right reason, then the least
   code that passes. Fast tests fake the process runner and need no cluster
   ([`skills/test-driven-development/SKILL.md`](../../skills/test-driven-development/SKILL.md)).
3. **Check:**

   ```sh
   cd tools/kore && npm run check && npm run lint && npm test
   mise run validate
   mise run test-opa
   mise run test-gatekeeper
   mise run test-promtool
   mise run kb-check -- --strict
   mise run scan
   ```

   Format by hand with `mise run format <files>`, never a bare `npx prettier`.

4. **Commit** with a Conventional Commit, lowercase imperative subject
   (`feat(ci): guard release signer permissions`). Hooks run typecheck, lint,
   format, and unit tests; `--no-verify` is blocked.

## Where things live

| Change                                | Look at                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| A `kore` command or flag              | `tools/kore/src/cli`; usage text in `usage.ts`; skill `skills/add-command/SKILL.md` |
| A domain (platform, app, images, ...) | `tools/kore/src/<domain>`; depend on its `index.ts`, not its internals              |
| A component, version, or seed         | `infra/catalog`; skill `skills/pin-upgrade/SKILL.md` for versions                   |
| A chart or environment setting        | `infra/charts`, `infra/environments/<name>`                                         |
| A policy                              | `infra/policies`; skill `skills/add-policy/SKILL.md`                                |
| A decision                            | `docs/decisions`; skill `skills/write-adr/SKILL.md`                                 |

## Tests

- `npm test` (in `tools/kore`) is fast and needs no cluster.
- Live specs (`*.integration.spec.ts`) create or destroy clusters. They run only
  when asked, with `KORE_RUN_INTEGRATION=1` through the scripts in
  `tools/kore/package.json` (`test:integration`, `test:integration:admission`,
  `test:integration:registry`). A change to what runs in a cluster needs a live
  run before merge.
- Upstream chart and container checks are opt-in too (`test:upstream-charts`,
  `test:container-smoke`).

## Rules that bite

- External processes run only through the injected runner; mutations name their
  environment and context.
- Secrets never touch disk or git in plaintext.
- Every command change updates the usage text and the README in the same change.
- New policies start in audit mode; versions are pinned exactly.
- Documents must be in [`docs/index.md`](../index.md) (ADRs, plans, and skills
  are required there; `mise run kb-check` checks).
