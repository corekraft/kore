import type { CliDeps, CommandContext, CommandHelp } from "../runtime/index.js";
import type { TerminalError, Terminals } from "../terminal/index.js";
import { hcMessage, routeSession, terminalsFor } from "./backend.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import {
  STDIN,
  USAGE,
  bothStdinError,
  contentOf,
  type Failed,
  type Input,
  type Summary,
} from "./report-input.js";
import {
  noticeLine,
  readReport,
  reportPath,
  type Report,
} from "./report-file.js";

const NOT_IN_TERMINAL =
  "Not inside an hc terminal (HC_TERMINAL_ID is unset). session report runs in the session's own terminal, which session spawn starts.";

function textOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The summary the flags name: exactly one of --summary and --file, and a non-empty --summary. */
function summaryOption(
  text: string | undefined,
  file: string | undefined,
): Summary | Failed {
  if (text !== undefined && file === undefined) {
    if (text === STDIN) {
      return { stdin: true };
    }
    return text.trim() === ""
      ? { error: `--summary must not be empty: ${USAGE}.` }
      : { text };
  }
  if (file !== undefined && text === undefined) {
    return { file };
  }
  return {
    error: `Give exactly one of --summary <text> or --file <path>: ${USAGE}.`,
  };
}

/** The flags as the command takes them, or the usage message that refuses them. */
function inputOf(options: CommandContext["options"]): Input | Failed {
  const outcome = options["outcome"];
  if (outcome !== "done" && outcome !== "blocked") {
    return { error: `--outcome must be done or blocked: ${USAGE}.` };
  }
  const summary = summaryOption(
    textOption(options["summary"]),
    textOption(options["file"]),
  );
  if ("error" in summary) {
    return summary;
  }
  if (options["plan"] === true) {
    return { error: `--plan needs a file path: ${USAGE}.` };
  }
  const plan = textOption(options["plan"]);
  if (plan === STDIN && "stdin" in summary) {
    return {
      error: bothStdinError(USAGE),
    };
  }
  return { outcome, summary, ...(plan === undefined ? {} : { plan }) };
}

/** The open hc record the terminal runs, or why this terminal may not report for one. */
async function openRecord(
  deps: CliDeps,
  terminals: Terminals,
  self: string,
): Promise<SessionRecord | Failed> {
  const registry = await SessionRegistry.open(deps);
  const record = await registry.findByTerminal(self);
  if (record === undefined) {
    return {
      error: `No open session record matches terminal ${self}. session report writes only for a session that session spawn started; nothing was written.`,
    };
  }
  const routed = routeSession(record, terminals);
  if ("error" in routed) {
    return { error: routed.error };
  }
  return record;
}

/** Sends the parent the notice when it is an agent terminal; the parent it names when it is not. */
async function notify(
  terminals: Terminals,
  parent: string | undefined,
  line: string,
): Promise<{ notified: string | undefined } | { error: TerminalError }> {
  if (parent === undefined) {
    return { notified: undefined };
  }
  const view = await terminals.get(parent);
  if ("error" in view) {
    return { error: view };
  }
  if (view.status === undefined) {
    return { notified: undefined };
  }
  const sent = await terminals.send(parent, line);
  return "error" in sent ? { error: sent } : { notified: parent };
}

/** What a report carries besides its seq and time. */
type Body = Pick<Report, "outcome" | "summary" | "plan">;

/** What a written report reports back: its path, seq and the parent it notified, if any. */
interface Delivered {
  path: string;
  seq: number;
  notified: string | undefined;
}

/** Writes the next seq of the report, then sends the parent its notice. */
async function deliver(
  deps: CliDeps,
  terminals: Terminals,
  record: SessionRecord,
  view: { cwd: string; parent?: string },
  body: Body,
): Promise<Delivered | Failed> {
  const path = reportPath(view.cwd, record.name);
  const seq = ((await readReport(deps.fs, path))?.seq ?? 0) + 1;
  const written: Report = {
    ...body,
    seq,
    at: deps.clock.now().toISOString(),
  };
  await deps.fs.writeFile(path, `${JSON.stringify(written, null, 2)}\n`);
  const notice = await notify(
    terminals,
    view.parent,
    noticeLine(record.name, body.outcome, seq, path),
  );
  if ("error" in notice) {
    return {
      error: `The report is written at ${path}, but the notice to ${view.parent} failed: ${hcMessage(notice.error)}.`,
    };
  }
  return { path, seq, notified: notice.notified };
}

/**
 * `session report --outcome done|blocked (--summary <text> | --file <path>) [--plan <file>]`: writes the
 * session's report with the next seq, then tells the parent one fixed line. Only an open hc record can report.
 */
export async function report(context: CommandContext): Promise<number> {
  const { json, deps, options } = context;
  const input = inputOf(options);
  if ("error" in input) {
    return fail(deps, json, USAGE_ERROR, input.error);
  }
  const terminals = terminalsFor(deps);
  const self = terminals.self();
  if (self === undefined) {
    return fail(deps, json, FAILED, NOT_IN_TERMINAL);
  }
  const record = await openRecord(deps, terminals, self);
  if ("error" in record) {
    return fail(deps, json, FAILED, record.error);
  }
  const view = await terminals.get(self);
  if ("error" in view) {
    return fail(
      deps,
      json,
      FAILED,
      `Session ${record.name}: ${hcMessage(view)}`,
    );
  }
  const content = await contentOf(deps, view.cwd, input);
  if ("error" in content) {
    return fail(deps, json, FAILED, content.error);
  }
  const delivered = await deliver(deps, terminals, record, view, {
    outcome: input.outcome,
    ...content,
  });
  if ("error" in delivered) {
    return fail(deps, json, FAILED, delivered.error);
  }
  const { path, seq, notified } = delivered;
  deps.stdout(
    json
      ? `${JSON.stringify({ name: record.name, outcome: input.outcome, seq, path, notified: notified ?? null })}\n`
      : `Wrote ${path} (seq ${seq}, ${input.outcome}). ${notified === undefined ? "No notice sent." : `Notified ${notified}.`}\n`,
  );
  return 0;
}

/** The help record `harness session report` shows at each level (plan 17). */
export const reportHelp: CommandHelp = {
  purpose:
    "Records how a spawned hc session finished as a numbered report file, which the waiting parent reads, then tells the parent in one fixed line that the report is there.",
  when: "As the last action of a session that session spawn started on hc, once its work is finished or it is blocked.",
  whenNot:
    "Outside a session's own terminal, which it refuses. After a rework, report again: each report takes the next seq, and the parent reads the new one.",
  flags: {
    outcome:
      "done when the work is finished, blocked when it cannot go on without a person.",
    summary:
      "The summary text, or - to read it from stdin, as a heredoc gives it. It is kept in the report file and is never sent to the parent.",
    file: "A file that holds the summary, under .kore/report in the session's checkout. Use it for a long answer.",
    plan: "A file whose text is stored with the report as its plan, such as a judgment's plan JSON, or - to read that text from stdin.",
  },
  examples: [
    {
      command:
        'harness session report --outcome done --summary "Opened PR #1775."',
      shows:
        "the report file is written with seq 1, and the parent gets one line naming it",
    },
    {
      command:
        "harness session report --outcome blocked --file .kore/report/why.md",
      shows:
        "a blocked report whose summary is read from a file under .kore/report",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the report is written; the parent got its notice, or is not an agent terminal",
    },
    {
      code: 1,
      meaning:
        "refused or failed: no open hc session for this terminal, a --file outside .kore/report, or hc or the notice failed; a report already written is kept",
    },
    {
      code: 2,
      meaning:
        "a usage error: --outcome, or exactly one of --summary and --file, is missing or wrong",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "Writes .kore/report/<session>.json in the session's checkout, then sends one notice line to the parent when it is an agent terminal.",
  },
  seeAlso: ["session wait", "session close"],
};
