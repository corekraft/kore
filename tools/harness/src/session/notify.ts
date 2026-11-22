import type { CliDeps, CommandContext, CommandHelp } from "../runtime/index.js";
import { signedMessage } from "../sender/index.js";
import { garbled, plain, withoutDim } from "./ansi.js";
import { describeFailure } from "./equalize.js";
import { PROMPT } from "./prompt.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { signedMainSendsOn } from "./signed-sends.js";

const CONFIRM_READS = 3;
const CONFIRM_PAUSE_MS = 1_000;
const USAGE = "session notify <pane> --outcome done|blocked";
/** The one move every role has left after a send that could not be confirmed. */
const NO_RESEND =
  "Do not send it again: `session wait` records your result from your RESULT line, so end your turn.";

/** The text a finished session sends its caller, after its sender line: the summary is in its own pane. */
export function finishText(outcome: string, ownPane: string): string {
  return `finished: RESULT ${outcome}; summary in pane ${ownPane}`;
}

/**
 * How many times the line shows as submitted. The last prompt line is the
 * input box, so text there is typed, not sent, and does not count.
 */
export function submitted(text: string, line: string): number {
  const lines = text.split("\n");
  const inputBox = lines.map((l) => PROMPT.test(l)).lastIndexOf(true);
  return lines.filter((l, i) => i !== inputBox && l.includes(line)).length;
}

/** Whitespace dropped, so a line broken at a space, or indented beneath its first row, still matches. */
const squeezed = (text: string): string => text.replace(/\s+/g, "");

/**
 * How many times the line shows as submitted once wrapped rows are rejoined (ADR 0123). The rows above the
 * input box are joined and counted; the input box, its last prompt line and every row beneath it, never counts.
 */
export function submittedRejoined(text: string, line: string): number {
  const lines = text.split("\n");
  const inputBox = lines.map((l) => PROMPT.test(l)).lastIndexOf(true);
  const shown = inputBox === -1 ? lines : lines.slice(0, inputBox);
  return squeezed(shown.join("\n")).split(squeezed(line)).length - 1;
}

/** The submitted count under the delivery rule in force: rejoined when signed-main-sends is on, line by line otherwise. */
function submittedIn(
  text: string,
  line: string,
  rejoinWrapped: boolean,
): number {
  return rejoinWrapped ? submittedRejoined(text, line) : submitted(text, line);
}

/**
 * True when the input box (the last prompt line) already holds typed text, so typing would cut it.
 * Faint text there is Claude Code's suggested prompt, not a draft, so it does not count.
 */
export function unsent(text: string): boolean {
  const last = text
    .split("\n")
    .filter((l) => PROMPT.test(plain(l)) || (garbled(l) && /[>❯]/.test(l)))
    .pop();
  return (
    last !== undefined &&
    (garbled(last) ||
      withoutDim(last)
        .replace(PROMPT, "")
        .replace(/[\s│|]+$/, "")
        .trim() !== "")
  );
}

/** The pane text now, styled so faint text can be told from typed text, or herdr's error when it cannot be read. */
async function readPane(
  deps: CliDeps,
  pane: string,
): Promise<string | { error: string }> {
  const read = await deps.runner.run("herdr", [
    "pane",
    "read",
    pane,
    "--source",
    "recent-unwrapped",
    "--ansi",
  ]);
  return read.code === 0 ? read.stdout : { error: describeFailure(read) };
}

/** The submitted count in the pane now, or herdr's error when it cannot be read. */
async function count(
  deps: CliDeps,
  pane: string,
  line: string,
  rejoinWrapped: boolean,
): Promise<number | { error: string }> {
  const text = await readPane(deps, pane);
  return typeof text === "string"
    ? submittedIn(plain(text), line, rejoinWrapped)
    : text;
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
  rejoinWrapped: boolean,
): Promise<"confirmed" | "missing" | { error: string }> {
  let outcome: "missing" | { error: string } = "missing";
  let anyRead = false;
  for (let read = 1; read <= CONFIRM_READS; read++) {
    const now = await count(deps, pane, line, rejoinWrapped);
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

/**
 * Sends the line and confirms it; an error message, or undefined once a new submitted line shows in the pane.
 * `rejoinWrapped` is signed-main-sends: it confirms a line that wrapped in the pane (ADR 0123).
 */
export async function deliver(
  deps: CliDeps,
  pane: string,
  line: string,
  options: { rejoinWrapped: boolean },
): Promise<string | undefined> {
  const { rejoinWrapped } = options;
  // Read first, so an identical older line is not taken for this one.
  const text = await readPane(deps, pane);
  if (typeof text !== "string") {
    return `herdr pane read ${pane} failed: ${text.error}. Nothing was sent, because delivery could not be confirmed afterwards.`;
  }
  if (unsent(text)) {
    return `Nothing was sent to ${pane}: its input box already holds unsent text. Retry later; \`session wait\` records your result from your RESULT line meanwhile.`;
  }
  const before = submittedIn(plain(text), line, rejoinWrapped);
  const sendError = await sendLine(deps, pane, line);
  if (sendError !== undefined) {
    return sendError;
  }
  const result = await confirmed(deps, pane, line, before, rejoinWrapped);
  if (result === "confirmed") {
    return undefined;
  }
  return result === "missing"
    ? `Delivery to ${pane} not confirmed: no new submitted line showed there in ${CONFIRM_READS} reads. ${NO_RESEND}`
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
  const signed = signedMessage(
    deps.env,
    "session notify",
    finishText(outcome, ownPane),
  );
  if ("error" in signed) {
    return fail(deps, json, FAILED, signed.error);
  }
  const error = await deliver(deps, pane, signed.body, {
    rejoinWrapped: await signedMainSendsOn(deps),
  });
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

export const notifyHelp: CommandHelp = {
  purpose:
    "Tells the caller pane that this spawned session finished: it sends one line, starting with its sender line, that names the outcome and the pane holding the summary, submits it, and reads the caller pane back to confirm the line arrived.",
  when: "As a spawned session's last action, after it has printed its RESULT line, so the caller hears of the finish without polling.",
  whenNot:
    "From the main session, or from any pane session spawn did not start: it refuses there, since only a spawned session has a name to report. To message a spawned session instead, use session send.",
  flags: {
    outcome:
      "The outcome the session reports, done or blocked; it must match the RESULT line the session printed.",
  },
  operand:
    "The caller's Herdr pane id, such as w3:p1. Only letters, digits, underscores and colons are accepted.",
  examples: [
    {
      command: "harness session notify w3:p1 --outcome done",
      shows:
        "the caller pane receives the finished line, and the command prints that it notified w3:p1 and exits 0",
    },
    {
      command: "harness session notify w3:p1 --outcome maybe",
      shows:
        "the outcome is not done or blocked, so the command exits 2 and sends nothing",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the line was delivered and its arrival confirmed in the caller pane",
    },
    {
      code: 1,
      meaning:
        "not inside a spawned session, the line could not be signed, or delivery failed or was not confirmed; when it was not confirmed, do not send again, since the line may have arrived",
    },
    {
      code: 2,
      meaning:
        "a usage error: the caller pane is missing or invalid, or the outcome is not done or blocked; nothing is sent",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "types and submits one line into the caller's pane and reads that pane back; writes no registry entry and no ledger event",
  },
  seeAlso: ["session send", "session wait"],
};
