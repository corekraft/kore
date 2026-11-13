import { join } from "node:path";
import { HARNESS_CONFIG, parseHarnessConfig } from "../flow/index.js";
import {
  POLLER_KINDS,
  pollSignals,
  type Kind,
  type Ledger,
} from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";

/** The login whose actions count as owner time: the harness config, else the repository's owner. There is no flag: an override would let a caller choose whose actions count. */
export async function ownerLogin(
  context: CommandContext,
  repo: string,
): Promise<string | { error: string }> {
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
  const since = context.options["since"];
  const polled = await pollSignals({
    ledger,
    runner,
    clock,
    fs,
    repo,
    owner,
    ...(typeof since === "string" ? { since } : {}),
  });
  return polled.ok ? polled : { ...polled, field: "github" };
}

/** Why an event may not be recorded by hand, or undefined. GitHub's records are written only by the poller, so an agent cannot add a result or pre-empt one by its id. */
export function pollerOnly(input: unknown): string | undefined {
  const { source, kind } = (input ?? {}) as Record<string, unknown>;
  if (source === "github" || POLLER_KINDS.includes(kind as Kind)) {
    return `Events from source github, and kinds ${POLLER_KINDS.join(", ")}, are not recordable by hand: only \`ledger poll-github\` writes them, from GitHub's own records.`;
  }
  return undefined;
}

export const DEFAULT_REPO = "corekraft/kore";

/** The --repo option as owner/name, or the refusal; the default when absent. */
export function repoOf(
  options: CommandContext["options"],
): string | { error: string } {
  const repo = options["repo"];
  if (typeof repo !== "string") {
    return DEFAULT_REPO;
  }
  return /^[\w.-]+\/[\w.-]+$/.test(repo)
    ? repo
    : {
        error: `Invalid --repo "${repo}". Use owner/name, such as ${DEFAULT_REPO}.`,
      };
}
