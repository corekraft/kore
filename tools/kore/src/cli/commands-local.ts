import {
  rotateRegistryCredentials,
  swapLocalSigningKey,
} from "../images/index.js";
import { localDown, localUp } from "../local/index.js";
import { installLocalTrust, syncLocalSecrets } from "../security/index.js";
import { mutateAction } from "./context.js";
import type { CommandContext } from "./context.js";
import { boolFlag } from "./flags.js";
import { print } from "./output.js";

export async function localCommand(context: CommandContext): Promise<number> {
  const { repository } = context;
  return await mutateAction(context, {
    up: async (_context, runner) => await localUp(repository, runner),
    down: async (_context, runner) =>
      await localDown(repository, runner, {
        prune: boolFlag(context.parsed, "prune"),
        purgeData: boolFlag(context.parsed, "purge-data"),
        force: boolFlag(context.parsed, "force"),
      }),
  });
}

export async function secretsCommand(context: CommandContext): Promise<number> {
  return await context.mutate(
    `secrets ${context.action ?? ""}`,
    async (runner) => {
      const rotate = boolFlag(context.parsed, "rotate");
      const count = await syncLocalSecrets(context.repository, runner, {
        rotate,
        yes: boolFlag(context.parsed, "yes"),
      });
      print(
        rotate
          ? {
              status: "rotated",
              files: count,
              next: "run kore local up to restart the consumers onto the new token",
            }
          : { status: "synced", files: count },
        context.json,
      );
      return 0;
    },
  );
}

export async function trustCommand(context: CommandContext): Promise<number> {
  return await context.mutate(
    `trust ${context.action ?? ""}`,
    async (runner) => {
      await installLocalTrust(context.repository, runner);
      print(
        {
          status: "installed",
          issuer: context.repository.environment.gateway.name,
        },
        context.json,
      );
      return 0;
    },
  );
}

export async function signerCommand(context: CommandContext): Promise<number> {
  return await mutateAction(context, {
    "swap-key": async (_context, runner) => {
      await swapLocalSigningKey(context.repository, runner, {
        yes: boolFlag(context.parsed, "yes"),
      });
      return print({ status: "swapped" }, context.json);
    },
  });
}

export async function registryCommand(
  context: CommandContext,
): Promise<number> {
  return await mutateAction(context, {
    "rotate-credentials": async (_context, runner) =>
      print(
        {
          status: "rotated",
          ...(await rotateRegistryCredentials(context.repository, runner, {
            yes: boolFlag(context.parsed, "yes"),
          })),
        },
        context.json,
      ),
  });
}
