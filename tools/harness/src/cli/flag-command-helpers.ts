import type { CommandContext } from "../runtime/index.js";
import { FlagError, parseReleaseLock } from "../flag/index.js";

// The helpers the flag commands share, kept apart so each command module stays under the file-size limit.

export const FAILED = 1;

export function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<number>,
): Promise<number> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof FlagError)) {
      throw error;
    }
    const prefix = json ? `${JSON.stringify({ error: error.message })}\n` : "";
    deps.stderr(`${prefix}${error.message}\n`);
    return FAILED;
  }
}

export async function root(context: CommandContext): Promise<string> {
  return await context.deps.root().catch((cause: unknown) => {
    throw new FlagError(cause instanceof Error ? cause.message : String(cause));
  });
}

/** The release chart lock named by --chart-lock, or undefined when none is named. */
export async function releaseLock(context: CommandContext, base: string) {
  const path = text(context.options, "chart-lock");
  if (path === undefined) {
    return undefined;
  }
  const lockText = await context.deps.fs
    .readFile(path.startsWith("/") ? path : `${base}/${path}`)
    .catch((cause: unknown) => {
      throw new FlagError(
        `Cannot read the release chart lock ${path}: ${cause instanceof Error ? cause.message : String(cause)}. Pass --chart-lock <platform-charts.lock.json> attached to the release.`,
      );
    });
  return parseReleaseLock(lockText, path);
}
