---
name: add-command
description: Use when adding or changing a `kore` CLI command, subcommand, or flag in tools/kore, or a `harness` command in tools/harness.
---

# Add a `kore` or `harness` command

Follow `AGENTS.md` and the `test-driven-development` skill. Write each failing test before its code.

## Checklist

1. **Place it in a domain.** Put the handler in the domain that owns the behavior under `tools/kore/src/<domain>/` and export it through that domain's `index.ts`. Depend on other domains only through their `index.ts`.
2. **Test with the fake runner.** Add a `*.spec.ts` beside the handler. Fake the process runner, assert on the commands it received, and cover what must not happen. Follow an existing spec in the same domain.
3. **Wire the dispatch.** Add the command to the `COMMANDS` table in `tools/kore/src/cli/commands.ts`, listing its mutating actions in `mutations`, and put its handler in the matching `cli/commands-*.ts` file (reads, infra, or local). Add a dispatch test in `cli-dispatch-reads.spec.ts`, `cli-dispatch-mutations.spec.ts`, or `cli-dispatch-rejections.spec.ts`. Flags are parsed in `cli/flags.ts`.
4. **Answer before wiring it up:**
   - Does it change anything? If so, it requires `--environment`, targets that environment's configured context (never the current one), and takes the environment lock.
   - Does it destroy anything? Keep the `--yes` gate. Does it destroy retained data? Keep `--purge-data` as a second opt-in.
   - Does it report state? Then it offers `--json`. What exactly does that object contain?
   - If it fails partway and is run again, does it recover?
5. **Keep docs in step.** Update the `usage` string in `cli/usage.ts` and the matching section of `README.md`. Two tests catch a missing entry: `cli/usage.spec.ts` fails, naming the command, when the usage text has no `kore <command>` line, and `integration/cli/readme-commands.spec.ts` fails, naming the command, when the README's Commands section has no `` `kore <command>` `` row.
6. **Declare its help (`harness` commands only).** Give the command a `help` record beside it in its `src/cli/<domain>-commands.ts` file, shaped as `CommandHelp` in `tools/harness/src/runtime/command.ts`: `purpose`, `when`, `whenNot`, a description for every declared flag and operand, at least one example with a `shows` line, `exits`, `effects` and `seeAlso`. `harness <domain> --help` shows the result. The registry spec `integration/help/command-registry.spec.ts` fails a command with no help, a declared flag with no description, or an example with no `shows` line. A new domain also needs a guide in `src/help/domain-guides.ts`. A new command is never added to `help/exemptions.ts`: that list names only the commands not yet documented, and a domain removes its lines as it documents them.
7. **Verify.** Run `mise run test-related <changed files>` (typecheck, lint and the related unit tests); CI runs the full suite. Never lower the thresholds.
