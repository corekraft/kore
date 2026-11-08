import { appDown, appStatus, appUp } from "../app/index.js";
import {
  clusterDestroy,
  clusterStatus,
  clusterStop,
  clusterUp,
} from "../cluster/index.js";
import {
  bootstrapControllers,
  platformDestroy,
  platformRender,
  platformStatus,
  platformStop,
  platformUp,
} from "../platform/index.js";
import { mutateAction } from "./context.js";
import type { CommandContext } from "./context.js";
import { boolFlag, stringFlag } from "./flags.js";
import { print } from "./output.js";

function destroyOptions(context: CommandContext): {
  yes: boolean;
  purgeData: boolean;
} {
  return {
    yes: boolFlag(context.parsed, "yes"),
    purgeData: boolFlag(context.parsed, "purge-data"),
  };
}

export async function clusterCommand(context: CommandContext): Promise<number> {
  const { repository, runner, json } = context;
  if (context.action === "status") {
    print(await clusterStatus(repository, runner), json);
    return 0;
  }
  return await mutateAction(context, {
    up: async (_context, mutationRunner) =>
      await clusterUp(repository, mutationRunner),
    stop: async (_context, mutationRunner) =>
      await clusterStop(repository, mutationRunner),
    destroy: async (_context, mutationRunner) =>
      await clusterDestroy(repository, mutationRunner, destroyOptions(context)),
  });
}

async function platformRenderCommand(context: CommandContext): Promise<number> {
  const output = stringFlag(context.parsed, "output");
  await platformRender(context.repository, context.runner, output);
  print(
    { status: "valid", output: output ?? "stdout discarded" },
    context.json,
  );
  return 0;
}

export async function platformCommand(
  context: CommandContext,
): Promise<number> {
  const { repository, runner, json } = context;
  if (context.action === "status") {
    print(await platformStatus(repository, runner), json);
    return 0;
  }
  if (context.action === "render") {
    return await platformRenderCommand(context);
  }
  return await mutateAction(context, {
    bootstrap: async (_context, mutationRunner) =>
      await bootstrapControllers(repository, mutationRunner),
    up: async (_context, mutationRunner) =>
      await platformUp(repository, mutationRunner),
    stop: async (_context, mutationRunner) =>
      await platformStop(repository, mutationRunner),
    destroy: async (_context, mutationRunner) =>
      await platformDestroy(
        repository,
        mutationRunner,
        destroyOptions(context),
      ),
  });
}

export async function appCommand(context: CommandContext): Promise<number> {
  const { repository, runner, json } = context;
  const name = context.parsed.positional[0];
  if (!name) {
    throw new Error("application name is required");
  }
  if (context.action === "status") {
    print(await appStatus(repository, runner, name), json);
    return 0;
  }
  return await mutateAction(
    context,
    {
      up: async (_context, mutationRunner) =>
        await appUp(repository, mutationRunner, name),
      down: async (_context, mutationRunner) => {
        const { retained, warnings } = await appDown(
          repository,
          mutationRunner,
          name,
        );
        for (const warning of warnings) {
          process.stderr.write(`warning: ${warning}\n`);
        }
        if (json) {
          print({ name, retained, ...(warnings.length && { warnings }) }, json);
        } else if (retained.length) {
          print({ name, retained }, json);
        }
      },
    },
    `app ${context.action ?? ""} ${name}`,
  );
}
