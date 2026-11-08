---
name: add-command
description: Use when adding or changing a `kore` CLI command, subcommand, or flag in tools/kore.
---

# Add a `kore` command

Follow `AGENTS.md` and the `test-driven-development` skill. Write each failing test before its code.

## Checklist

1. **Place it in a domain.** Put the handler in the domain that owns the behavior under `tools/kore/src/<domain>/` and export it through that domain's `index.ts`. Depend on other domains only through their `index.ts`.
2. **Test with the fake runner.** Add a `*.spec.ts` beside the handler. Fake the process runner, assert on the commands it received, and cover what must not happen. Follow an existing spec in the same domain.
3. **Wire the dispatch.** Add the case in `tools/kore/src/cli/cli.ts` and a dispatch test in `cli-dispatch.spec.ts`. Flags are parsed in `cli/flags.ts`.
4. **Gate mutations.** A mutation requires `--environment`, targets that environment's configured context, takes the environment lock, and keeps the `--yes` and `--purge-data` gates for destruction.
5. **Offer `--json`** for any command that reports state.
6. **Keep docs in step.** Update the `usage` string in `cli.ts` and the matching section of `README.md`.
7. **Verify.** Run `mise run test` (typecheck, build, tests, coverage thresholds) and `npm --prefix tools/kore run lint`. Never lower the thresholds.
