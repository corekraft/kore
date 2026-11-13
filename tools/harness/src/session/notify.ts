import type { CliDeps, CommandContext } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";

const CONFIRM_READS = 3;
const CONFIRM_PAUSE_MS = 1_000;

/** The line a finished session sends its caller: the name is the session's own, and the summary is in its pane. */
export function finishLine(
  name: string,
  outcome: string,
  ownPane: string,
): string {
  return `[herdr:${name}] finished: RESULT ${outcome}; summary in pane ${ownPane}`;
}

/** Whether the caller pane's recent output holds the line, as a whole line. */
async function shows(
  deps: CliDeps,
  pane: string,
  line: string,
): Promise<boolean> {
  const read = await deps.runner.run("herdr", [
    "pane",
    "read",
    pane,
    "--source",
    "recent-unwrapped",
  ]);
  return (
    read.code === 0 && read.stdout.split("\n").some((l) => l.includes(line))
  );
}

/** Types the line into the pane and submits it; an error message, or undefined when both steps succeed. */
async function sendLine(
  deps: CliDeps,
  pane: string,
  line: string,
): Promise<string | undefined> {
  const sent = await deps.runner.run("herdr", [
    "pane",
    "send-text",
    pane,
    line,
  ]);
  if (sent.code !== 0) {
    return `herdr pane send-text to ${pane} failed: ${describeFailure(sent)}`;
  }
  const submitted = await deps.runner.run("herdr", [
    "pane",
    "send-keys",
    pane,
    "enter",
  ]);
  return submitted.code === 0
    ? undefined
    : `herdr pane send-keys to ${pane} failed: ${describeFailure(submitted)}. The line is typed but not submitted in pane ${pane}.`;
}

/** Reads the pane back until the line shows, pausing between reads; false when it never does. */
async function confirmed(
  deps: CliDeps,
  pane: string,
  line: string,
): Promise<boolean> {
  for (let read = 1; read <= CONFIRM_READS; read++) {
    if (await shows(deps, pane, line)) {
      return true;
    }
    if (read < CONFIRM_READS) {
      await deps.clock.sleep(CONFIRM_PAUSE_MS);
    }
  }
  return false;
}

/**
 * `session notify <pane> --outcome done|blocked`: a spawned session's finish notice.
 * It sends the line to the caller pane, submits it, then reads that pane back to confirm it arrived.
 */
export async function notify(context: CommandContext): Promise<number> {
  const { json, deps, options } = context;
  const pane = context.operand;
  if (pane === undefined || !/^[\w:]+$/.test(pane)) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "Missing or invalid caller pane: session notify <pane> --outcome done|blocked, where <pane> is a Herdr pane id such as w3:p1.",
    );
  }
  if (options.outcome !== "done" && options.outcome !== "blocked") {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "--outcome must be done or blocked: session notify <pane> --outcome done|blocked.",
    );
  }
  const name = deps.env["KORE_AGENT"];
  const ownPane = deps.env["HERDR_PANE_ID"];
  if (
    name === undefined ||
    name === "" ||
    ownPane === undefined ||
    ownPane === ""
  ) {
    return fail(
      deps,
      json,
      FAILED,
      "Not inside a spawned session (KORE_AGENT or HERDR_PANE_ID is unset). session notify runs in the pane session spawn started.",
    );
  }
  const line = finishLine(name, options.outcome, ownPane);
  const sendError = await sendLine(deps, pane, line);
  if (sendError !== undefined) {
    return fail(deps, json, FAILED, sendError);
  }
  if (!(await confirmed(deps, pane, line))) {
    return fail(
      deps,
      json,
      FAILED,
      `Delivery to ${pane} not confirmed: the finish line did not show there after ${CONFIRM_READS} reads. It was sent and submitted, so check pane ${pane} before sending it again.`,
    );
  }
  const summary = { pane, name, outcome: options.outcome, delivered: true };
  deps.stdout(
    json
      ? `${JSON.stringify(summary)}\n`
      : `Notified ${pane}: ${name} finished: RESULT ${options.outcome}.\n`,
  );
  return 0;
}
