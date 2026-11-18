// `session prompt-size` (#1038): a session's latest prompt size against the compaction cap, read
// from its transcript. Read-only: it writes nothing and names no transcript path. The cap is the
// harness config's compactionCap; with none it prints "not set" and exits 0. A malformed config
// fails with its own message, and so does a missing transcript, never a size of zero.

import { join } from "node:path";
import { HARNESS_CONFIG, parseHarnessConfig } from "../flow/index.js";
import type { Command, CommandContext, CliDeps } from "../runtime/index.js";
import { promptJsonOf, promptLineOf, promptSizeOf } from "./prompt-size.js";
import { locateDefault, locateNamed } from "./prompt-size-read.js";

const FAILED = 1;
const USAGE_ERROR = 2;

/** A Claude session id: letters, digits, "-" and "_", so no path separator can reach the lookup. */
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** Prints the message (and, with --json, a JSON error line) to stderr; returns the exit code. */
function fail(
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

const BAD_ID = (id: string) =>
  `Invalid session id "${id}": give the Claude session id, letters, digits, "-" and "_" only.`;

const NO_REQUEST = (session: string) =>
  `Session ${session} has no request with usage yet, so its prompt size is not available. Run the command again after the session makes a request.`;

/** The compaction cap the harness config sets, none when the checkout has no config; a bad config is refused. */
async function capOf(
  deps: CliDeps,
  root: string,
): Promise<{ cap: number | undefined } | { error: string }> {
  const file = join(root, HARNESS_CONFIG);
  if (!(await deps.fs.exists(file))) {
    return { cap: undefined };
  }
  const parsed = parseHarnessConfig(
    await deps.fs.readFile(file),
    HARNESS_CONFIG,
  );
  return "error" in parsed
    ? { error: parsed.error }
    : { cap: parsed.compactionCap };
}

async function promptSizeRun({
  json,
  deps,
  operand,
}: CommandContext): Promise<number> {
  if (operand !== undefined && !SESSION_ID.test(operand)) {
    return fail(deps, json, USAGE_ERROR, BAD_ID(operand));
  }
  const root = await deps.root();
  const config = await capOf(deps, root);
  if ("error" in config) {
    return fail(deps, json, FAILED, config.error);
  }
  const located =
    operand === undefined
      ? await locateDefault(deps, root)
      : await locateNamed(deps, root, operand);
  if ("error" in located) {
    return fail(deps, json, FAILED, located.error);
  }
  const size = promptSizeOf(located.session, located.text, config.cap);
  if (size === undefined) {
    return fail(deps, json, FAILED, NO_REQUEST(located.session));
  }
  deps.stdout(json ? promptJsonOf(size) : promptLineOf(size));
  return 0;
}

export const promptSizeCommand: Command = {
  summary:
    "print a session's latest prompt size, the compaction cap and over or not over, from its transcript (read-only; no name reads this checkout's newest session and prints its id, a name is a Claude session id of this repository; a missing cap prints not set; --json prints the same fields)",
  operand: "session",
  run: promptSizeRun,
};
