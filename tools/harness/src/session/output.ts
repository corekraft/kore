import type { CliDeps } from "../runtime/index.js";

export const USAGE_ERROR = 2;
export const FAILED = 1;

/** Prints the message (and, with --json, a JSON error line) to stderr; returns the exit code. */
export function fail(
  deps: CliDeps,
  json: boolean,
  code: number,
  message: string,
): number {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return code;
}
