#!/usr/bin/env node
// Docs: infra/plans/2-implementation.md#public-command-surface
import { loadRepository } from "../config/index.js";
import {
  ProcessRunner,
  withRequestTimeout,
  withTransientRetry,
} from "../runtime/index.js";
import { COMMANDS, isMutating, usage } from "./commands.js";
import type { CommandContext } from "./context.js";
import {
  boolFlag,
  parseArgs,
  requireEnvironment,
  stringFlag,
} from "./flags.js";
import { createMutate } from "./mutation.js";

const defaultCommandTimeoutMs = 30 * 60_000;
const kubectlRequestTimeout = "30s";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0],
    action = argv[1];
  if (!command || command === "help" || command === "--help") {
    console.log(usage);
    return 0;
  }
  const spec = COMMANDS.get(command);
  if (spec === undefined) {
    // Unknown commands still load the default repository, as before.
    await loadRepository(
      stringFlag(parseArgs(argv.slice(2)), "environment") ?? "local",
    );
    throw new Error(`unknown command: ${command}\n\n${usage}`);
  }
  const parsed = parseArgs(argv.slice(spec.noAction ? 1 : 2));
  const environmentName = isMutating(spec, action)
    ? requireEnvironment(parsed)
    : (stringFlag(parsed, "environment") ?? "local");
  const repository = await loadRepository(environmentName);
  // A command that runs this long is hung, not slow: kill it and name the cause.
  const runner = withTransientRetry(
    withRequestTimeout(
      new ProcessRunner({ defaultTimeoutMs: defaultCommandTimeoutMs }),
      kubectlRequestTimeout,
    ),
  );
  const context: CommandContext = {
    command,
    action,
    parsed,
    repository,
    environmentName,
    runner,
    json: boolFlag(parsed, "json"),
    mutate: createMutate({
      command,
      action,
      mutations: spec.mutations,
      environmentName,
      repository,
      runner,
    }),
  };
  return await spec.run(context);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
