import type { CommandContext, CommandHelp } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { routeSession, terminalsFor } from "./backend.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { formatReportWait, waitForReport } from "./wait-hc.js";

export const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

/** A timeout in milliseconds from the flag, or an error message. */
export function parseTimeout(
  value: string | boolean | undefined,
): number | { error: string } {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  const ms = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(ms) && ms > 0
    ? ms
    : { error: "--timeout must be a positive whole number of milliseconds." };
}

/** `session wait <name>`: waits for a spawned session to settle on its report, then prints its outcome. */
export async function wait(context: CommandContext): Promise<number> {
  const { json, deps, options } = context;
  const name = context.operand;
  if (name === undefined) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "Missing the session name: session wait <name>.",
    );
  }
  const nameError = sessionNameError(name);
  if (nameError !== undefined) {
    return fail(deps, json, USAGE_ERROR, nameError);
  }
  const timeout = parseTimeout(options.timeout);
  if (typeof timeout !== "number") {
    return fail(deps, json, USAGE_ERROR, timeout.error);
  }
  const registry = await SessionRegistry.open(deps);
  const record = await registry.read(name);
  if (record === undefined) {
    return fail(
      deps,
      json,
      FAILED,
      `No session named ${name} was spawned by this tool; start it with \`session spawn\`.`,
    );
  }
  const routed = routeSession(record, terminalsFor(deps));
  if ("error" in routed) {
    return fail(deps, json, FAILED, routed.error);
  }
  return await settleOnReport(
    context,
    routed.terminals,
    registry,
    record,
    timeout,
  );
}

/** Settles an hc session by its report, and prints the outcome it settles on. */
async function settleOnReport(
  context: CommandContext,
  terminals: Terminals,
  registry: SessionRegistry,
  record: SessionRecord,
  timeout: number,
): Promise<number> {
  const { json, deps } = context;
  const reported = await waitForReport(
    deps,
    terminals,
    registry,
    record,
    timeout,
  );
  if ("error" in reported) {
    return fail(deps, json, FAILED, reported.error);
  }
  deps.stdout(
    json ? `${JSON.stringify(reported)}\n` : formatReportWait(reported),
  );
  return 0;
}

export const waitHelp: CommandHelp = {
  purpose:
    "Waits for one spawned session to settle, then prints its outcome, done or blocked, with its name and model. A session settles on its report file: done or blocked as the report says, or blocked, stopped without a report, when its terminal stops with none. --json prints {name, model, outcome, summary, seq}, with seq absent when it settled without a report.",
  when: "When a session started with session spawn must be collected, typically in the background, so the main session hears when it settles.",
  whenNot:
    "To watch several targets at once, use harness wait. To see what a session's terminal shows now, read it with hc read: this command only settles on a report or a stop.",
  flags: {
    timeout:
      "The bound in milliseconds, a positive whole number; the default is one hour. For a session the bound applies to waiting for its terminal to stop: when it passes with no report, the command exits 1 and the session keeps running, unless the terminal turned blocked or errored meanwhile, which settles as blocked and exits 0.",
  },
  operand:
    "The spawned session's name, as session spawn recorded it, such as image-trust-reader. A name this tool did not spawn is refused.",
  examples: [
    {
      command: "harness session wait image-trust-reader --timeout 600000",
      shows:
        "the session's report outcome once it is written, or exit 1 after ten minutes with the session still working",
    },
    {
      command: "harness session wait image-trust-reader --json",
      shows:
        "the outcome as one JSON object, with the summary the report carried and its seq",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "its report showed, or it settled as blocked (blocked or errored status, or its terminal stopped without a report), and the outcome is printed",
    },
    {
      code: 1,
      meaning:
        "no session of this tool has that name, its record has no terminal, its terminal could not be read, or it was still working with no report when the timeout passed",
    },
    {
      code: 2,
      meaning:
        "a usage error: no name, an invalid name, or a timeout that is not a positive whole number of milliseconds",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "records the report's outcome and summary on the session's registry entry, and its seq as consumed, so a later wait settles only on a newer report; a stop with no report is recorded as blocked",
  },
  seeAlso: ["session spawn", "harness wait", "session close"],
};
