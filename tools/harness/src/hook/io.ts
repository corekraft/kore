import { CommandError, type Command, type CliDeps } from "../runtime/index.js";

/** What a hook did: text for the host and the exit code it signals with. */
export interface HookResult {
  code?: number;
  stdout?: string;
  stderr?: string;
}

export interface HookContext {
  deps: CliDeps;
  /** The JSON the host sent on stdin; undefined when stdin was empty or not JSON. */
  payload: unknown;
}

/** Parses stdin as JSON, treating empty or malformed input as no payload. */
export async function readPayload(deps: CliDeps): Promise<unknown> {
  const text = await deps.stdin();
  if (text.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Wraps a hook as a command. The host speaks stdin JSON, exit code, stdout and
 * stderr. A hook that breaks unexpectedly fails open: it reports on stderr and
 * exits 0, so a harness fault never blocks the session.
 */
export function hookCommand(
  name: string,
  summary: string,
  handler: (context: HookContext) => Promise<HookResult>,
): Command {
  return {
    summary,
    async run({ deps }) {
      let result: HookResult;
      try {
        result = await handler({ deps, payload: await readPayload(deps) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const hint =
          error instanceof CommandError
            ? ""
            : " (unexpected; fixing it is on the harness)";
        deps.stderr(`[hook:${name}] failed open: ${reason}${hint}\n`);
        return 0;
      }
      if (result.stdout) {
        deps.stdout(result.stdout);
      }
      if (result.stderr) {
        deps.stderr(result.stderr);
      }
      return result.code ?? 0;
    },
  };
}
