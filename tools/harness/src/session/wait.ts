import type { CliDeps, CommandContext, CommandHelp } from "../runtime/index.js";
import { plain } from "./ansi.js";
import { describeFailure } from "./equalize.js";
import { recordFinish } from "./finish-record.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { PROMPT } from "./prompt.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";

export const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const POLL_MS = 2000;
/** The most characters of a pane result summary kept; the cap is a placeholder (ADR 0123). */
export const SUMMARY_CAP = 2000;

/** What `session wait` and a waiting `session spawn` return. */
export interface WaitResult {
  name: string;
  paneId: string;
  model: string;
  outcome: "done" | "blocked";
  /** Where the summary is: the finished session's own pane. */
  summary: string;
  /** The pane result: its outcome word and the text the pane printed before its RESULT line. */
  result: { outcome: "done" | "blocked"; summary: string };
}

/** Only a line that is nothing but the marker (after indent or Claude's bullet) counts; brief text never is. */
const MARKER = /^[ \t]*(?:[●⏺][ \t]+)?RESULT: (done|blocked)[ \t\r]*$/gm;

/** The outcome word of the last anchored marker line, or undefined when there is none. */
export function findResult(text: string): "done" | "blocked" | undefined {
  const last = [...text.matchAll(MARKER)].at(-1)?.[1];
  return last === "done" || last === "blocked" ? last : undefined;
}

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

function seconds(ms: number): string {
  return `${ms / 1000} seconds`;
}

/**
 * The text the pane printed between its last prompt line and its last RESULT
 * line: plain, trimmed and capped with an ellipsis. Empty when the RESULT line
 * follows the prompt directly, or when the text has no RESULT line.
 */
export function resultSummary(text: string): string {
  const marker = [...text.matchAll(MARKER)].at(-1);
  if (marker?.index === undefined) {
    return "";
  }
  const lines = text.slice(0, marker.index).split("\n");
  const prompt = lines.findLastIndex((line) => PROMPT.test(plain(line)));
  const body = plain(lines.slice(prompt + 1).join("\n")).trim();
  return body.length > SUMMARY_CAP
    ? `${body.slice(0, SUMMARY_CAP - 1)}…`
    : body;
}

/** The wait's answer for a session that has settled, with its recorded or read outcome and summary. */
function settled(
  record: SessionRecord,
  outcome: "done" | "blocked",
  summary: string,
): WaitResult {
  return {
    name: record.name,
    paneId: record.paneId,
    model: record.model,
    outcome,
    summary: `pane ${record.paneId}`,
    result: { outcome, summary },
  };
}

/**
 * Reads the session's own pane once, unwrapped. It settles on an anchored marker line, records
 * the outcome, its summary and pane.finished, and returns the result; undefined means no marker
 * yet, and nothing is recorded. A recorded result settles at once, without reading the pane.
 * An error message is returned when the pane cannot be read (ADR 0123).
 */
export async function readResult(
  deps: CliDeps,
  registry: SessionRegistry,
  record: SessionRecord,
): Promise<WaitResult | { error: string } | undefined> {
  if (record.result !== undefined) {
    return settled(record, record.result.outcome, record.result.summary ?? "");
  }
  const read = await deps.runner.run("herdr", [
    "pane",
    "read",
    record.paneId,
    "--source",
    "recent-unwrapped",
  ]);
  if (read.code !== 0) {
    return {
      error: `herdr pane read ${record.paneId} failed: ${describeFailure(read)}`,
    };
  }
  const outcome = findResult(read.stdout);
  if (outcome === undefined) {
    return undefined;
  }
  const summary = resultSummary(read.stdout);
  await registry.write({
    ...record,
    result: { outcome, at: deps.clock.now().toISOString(), summary },
  });
  await recordFinish(deps, record.paneId, record.name, outcome);
  return settled(record, outcome, summary);
}

/**
 * Polls the session's own pane, unwrapped, until an anchored marker line shows,
 * then records the outcome and its summary. An error message is returned when it never does.
 */
export async function waitForResult(
  deps: CliDeps,
  registry: SessionRegistry,
  record: SessionRecord,
  timeoutMs: number,
): Promise<WaitResult | { error: string }> {
  const deadline = deps.clock.now().getTime() + timeoutMs;
  for (;;) {
    const result = await readResult(deps, registry, record);
    if (result !== undefined) {
      return result;
    }
    if (deps.clock.now().getTime() + POLL_MS > deadline) {
      return {
        error: `Session ${record.name} printed no "RESULT: done" or "RESULT: blocked" line in pane ${record.paneId} within ${seconds(timeoutMs)}. It may still be working; run \`session wait ${record.name}\` again or read the pane.`,
      };
    }
    await deps.clock.sleep(POLL_MS);
  }
}

export function formatWait(result: Omit<WaitResult, "result">): string {
  return `${result.name} (${result.model}) finished: RESULT ${result.outcome}; summary in ${result.summary}.\n`;
}

/** `session wait <name>`: wait for a spawned session's anchored result marker. */
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
  const result = await waitForResult(deps, registry, record, timeout);
  if ("error" in result) {
    return fail(deps, json, FAILED, result.error);
  }
  deps.stdout(json ? `${JSON.stringify(result)}\n` : formatWait(result));
  return 0;
}

export const waitHelp: CommandHelp = {
  purpose:
    "Waits for one spawned session's RESULT line in its own pane, then prints its outcome, done or blocked, with its name, model and where the summary is. With --json it adds the summary text the pane printed before that line.",
  when: "When a session started with --no-wait must be collected, typically in the background, so the main session hears when it settles.",
  whenNot:
    "When the session was started without --no-wait, since session spawn already waited for it. To watch several targets at once, use harness wait. To see what a pane shows now, read the pane with herdr: this command only settles on the RESULT line.",
  flags: {
    timeout:
      "The bound in milliseconds, a positive whole number; the default is one hour. When it passes with no RESULT line, the command exits 1 and the session keeps running.",
  },
  operand:
    "The spawned session's name, as session spawn recorded it, such as image-trust-reader. A name this tool did not spawn is refused.",
  examples: [
    {
      command: "harness session wait image-trust-reader --timeout 600000",
      shows:
        "the session's RESULT line and outcome once it prints one, or exit 1 after ten minutes with no line",
    },
    {
      command: "harness session wait image-trust-reader --json",
      shows:
        "the same outcome as one JSON object, with the summary the pane printed before its RESULT line",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the RESULT line showed and its outcome is printed; a blocked outcome also exits 0",
    },
    {
      code: 1,
      meaning:
        "no session of this tool has that name, its pane could not be read, or no RESULT line came within the timeout",
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
      "once a RESULT line shows, records the outcome and its summary on the session's registry entry and appends a pane.finished ledger event; until then it only reads the pane",
  },
  seeAlso: ["session spawn", "harness wait", "session close"],
};
