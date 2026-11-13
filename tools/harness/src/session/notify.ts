import type { CliDeps, CommandContext } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";

const CONFIRM_READS = 3;
const CONFIRM_PAUSE_MS = 1_000;
const USAGE = "session notify <pane> --outcome done|blocked";
/** The one move every role has left after a send that could not be confirmed. */
const NO_RESEND =
  "Do not send it again: `session wait` records your result from your RESULT line, so end your turn.";

/** The line a finished session sends its caller: the name is the session's own, and the summary is in its pane. */
export function finishLine(
  name: string,
  outcome: string,
  ownPane: string,
): string {
  return `[herdr:${name}] finished: RESULT ${outcome}; summary in pane ${ownPane}`;
}

/** A line that starts with the agent's prompt mark, after any box border. */
const PROMPT = /^[\s│|]*[>❯]/;

/**
 * How many times the line shows as submitted. The last prompt line is the
 * input box, so text there is typed, not sent, and does not count.
 */
export function submitted(text: string, line: string): number {
  const lines = text.split("\n");
  const inputBox = lines.map((l) => PROMPT.test(l)).lastIndexOf(true);
  return lines.filter((l, i) => i !== inputBox && l.includes(line)).length;
}

/** The submitted count in the pane now, or herdr's error when it cannot be read. */
async function count(
  deps: CliDeps,
  pane: string,
  line: string,
): Promise<number | { error: string }> {
  const read = await deps.runner.run("herdr", [
    "pane",
    "read",
    pane,
    "--source",
    "recent-unwrapped",
  ]);
  return read.code === 0
    ? submitted(read.stdout, line)
    : { error: describeFailure(read) };
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
  const entered = await deps.runner.run("herdr", [
    "pane",
    "send-keys",
    pane,
    "enter",
  ]);
  return entered.code === 0
    ? undefined
    : `herdr pane send-keys to ${pane} failed: ${describeFailure(entered)}. The line is typed but not submitted in pane ${pane}.`;
}

/**
 * Reads the pane back until it shows more submitted lines than before the send.
 * When it never does: `missing` if any read worked, else the last read's error.
 */
async function confirmed(
  deps: CliDeps,
  pane: string,
  line: string,
  before: number,
): Promise<"confirmed" | "missing" | { error: string }> {
  let outcome: "missing" | { error: string } = "missing";
  let anyRead = false;
  for (let read = 1; read <= CONFIRM_READS; read++) {
    const now = await count(deps, pane, line);
    if (typeof now === "number" && now > before) {
      return "confirmed";
    }
    anyRead ||= typeof now === "number";
    outcome = typeof now === "number" || anyRead ? "missing" : now;
    if (read < CONFIRM_READS) {
      await deps.clock.sleep(CONFIRM_PAUSE_MS);
    }
  }
  return outcome;
}

/** Sends the line and confirms it; an error message, or undefined once a new submitted line shows in the pane. */
async function deliver(
  deps: CliDeps,
  pane: string,
  line: string,
): Promise<string | undefined> {
  // Read first, so an identical older line is not taken for this one.
  const before = await count(deps, pane, line);
  if (typeof before !== "number") {
    return `herdr pane read ${pane} failed: ${before.error}. Nothing was sent, because delivery could not be confirmed afterwards.`;
  }
  const sendError = await sendLine(deps, pane, line);
  if (sendError !== undefined) {
    return sendError;
  }
  const result = await confirmed(deps, pane, line, before);
  if (result === "confirmed") {
    return undefined;
  }
  return result === "missing"
    ? `Delivery to ${pane} not confirmed: no new submitted finish line showed there in ${CONFIRM_READS} reads. ${NO_RESEND}`
    : `herdr pane read ${pane} failed: ${result.error}, so delivery to ${pane} is not confirmed. ${NO_RESEND}`;
}

/**
 * `session notify <pane> --outcome done|blocked`: a spawned session's finish notice.
 * It sends the line to the caller pane, submits it, then reads that pane back to confirm it arrived.
 */
export async function notify(context: CommandContext): Promise<number> {
  const { json, deps, options } = context;
  const pane = context.operand;
  const outcome = options["outcome"];
  if (pane === undefined || !/^[\w:]+$/.test(pane)) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      `Missing or invalid caller pane: ${USAGE}, where <pane> is a Herdr pane id such as w3:p1.`,
    );
  }
  if (outcome !== "done" && outcome !== "blocked") {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      `--outcome must be done or blocked: ${USAGE}.`,
    );
  }
  const name = deps.env["KORE_AGENT"];
  const ownPane = deps.env["HERDR_PANE_ID"];
  if (!name || !ownPane) {
    return fail(
      deps,
      json,
      FAILED,
      "Not inside a spawned session (KORE_AGENT or HERDR_PANE_ID is unset). session notify runs in the pane session spawn started.",
    );
  }
  const error = await deliver(deps, pane, finishLine(name, outcome, ownPane));
  if (error !== undefined) {
    return fail(deps, json, FAILED, error);
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ pane, name, outcome, delivered: true })}\n`
      : `Notified ${pane}: ${name} finished: RESULT ${outcome}.\n`,
  );
  return 0;
}
