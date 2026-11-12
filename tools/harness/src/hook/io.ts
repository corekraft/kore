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
  /** The flags the hook declared, as parsed. */
  options: Readonly<Record<string, string | boolean>>;
  /** The one positional argument, for a hook that declares an operand such as a mode. */
  operand: string | undefined;
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

export interface HookShape {
  flags?: Record<string, "string" | "boolean">;
  payload?: boolean;
  /** Names the one positional argument, such as the feedback hook's mode. */
  operand?: string;
}

/**
 * Wraps a hook as a command. The host speaks stdin JSON, exit code, stdout and
 * stderr. A hook that breaks unexpectedly fails open: it reports on stderr and
 * exits 0, so a harness fault never blocks the session. A check that must not
 * pass when it cannot run (mise, CI) adds --strict, which exits 1 instead. A
 * hook with flags of its own declares them in `flags`; one that ignores the
 * host's JSON sets `payload: false`, so a run by hand never waits on stdin.
 */
export function hookCommand(
  name: string,
  summary: string,
  handler: (context: HookContext) => Promise<HookResult>,
  { flags = {}, payload = true, operand }: HookShape = {},
): Command {
  return {
    summary,
    options: { ...flags, strict: "boolean" },
    ...(operand === undefined ? {} : { operand }),
    async run({ deps, options, operand: given }) {
      let result: HookResult;
      try {
        result = await handler({
          deps,
          options,
          operand: given,
          payload: payload ? await readPayload(deps) : undefined,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const hint =
          error instanceof CommandError
            ? ""
            : " (unexpected; fixing it is on the harness)";
        const strict = options["strict"] === true;
        deps.stderr(
          `[hook:${name}] ${strict ? "failed" : "failed open"}: ${reason}${hint}\n`,
        );
        return strict ? 1 : 0;
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
