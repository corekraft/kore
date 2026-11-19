import {
  installResolver,
  systemResolverHost,
  terminalConfirm,
  uninstallResolver,
} from "../resolver/index.js";
import { mutateAction } from "./context.js";
import type { CommandContext } from "./context.js";
import { boolFlag } from "./flags.js";
import { print } from "./output.js";

/**
 * Writes or removes the host resolver file for the environment's platform
 * domain (ADR 0132). The file is the only host change: the confirmation names
 * it, and the elevated rights go through the runner.
 */
export async function dnsCommand(context: CommandContext): Promise<number> {
  if (context.action !== "install" && context.action !== "uninstall") {
    throw new Error(
      "kore dns needs an action: install or uninstall, for example kore dns install --environment local",
    );
  }
  const host = systemResolverHost();
  const options = {
    yes: boolFlag(context.parsed, "yes"),
    confirm: terminalConfirm(Boolean(process.stdin.isTTY)),
  };
  const environment = context.repository.environment;
  return await mutateAction(context, {
    install: async (_context, runner) =>
      print(
        await installResolver(environment, runner, host, options),
        context.json,
      ),
    uninstall: async (_context, runner) =>
      print(
        await uninstallResolver(environment, runner, host, options),
        context.json,
      ),
  });
}
