import { join } from "node:path";
import { HARNESS_CONFIG, parseHarnessConfig } from "../flow/index.js";
import { pollSignals, type Ledger } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";

/** The login whose actions count as owner time: --owner, else the harness config, else the repository's owner. */
export async function ownerLogin(
  context: CommandContext,
  repo: string,
): Promise<string | { error: string }> {
  const given = context.options["owner"];
  if (typeof given === "string") {
    return given;
  }
  const root = await context.deps.root().catch(() => undefined);
  const file = root === undefined ? undefined : join(root, HARNESS_CONFIG);
  if (file !== undefined && (await context.deps.fs.exists(file))) {
    const config = parseHarnessConfig(
      await context.deps.fs.readFile(file),
      HARNESS_CONFIG,
    );
    if ("error" in config) {
      return config;
    }
    if (config.ownerLogin !== undefined) {
      return config.ownerLogin;
    }
  }
  return repo.split("/")[0] ?? repo;
}

/** Polls the outcome signals for the owner login this command resolves; the events recorded, or an error message. */
export async function pollOutcomeSignals(
  context: CommandContext,
  ledger: Ledger,
  repo: string,
) {
  const owner = await ownerLogin(context, repo);
  if (typeof owner !== "string") {
    return { ok: false as const, message: owner.error, field: "config" };
  }
  const { runner, clock, fs } = context.deps;
  const polled = await pollSignals({ ledger, runner, clock, fs, repo, owner });
  return polled.ok ? polled : { ...polled, field: "github" };
}
