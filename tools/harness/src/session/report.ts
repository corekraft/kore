import { resolve } from "node:path";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import type { TerminalError, Terminals } from "../terminal/index.js";
import { hcMessage, routeSession, terminalsFor } from "./backend.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import {
  isInsideReportDir,
  noticeLine,
  readReport,
  reportDirOf,
  reportPath,
  type Report,
} from "./report-file.js";

const USAGE =
  "session report --outcome done|blocked (--summary <text> | --file <path>) [--plan <file>]";
const NOT_IN_TERMINAL =
  "Not inside an hc terminal (HC_TERMINAL_ID is unset). session report runs in the session's own terminal, which session spawn starts.";

/** The summary as the flags gave it: the text itself, or the file that holds it. */
type Summary = { text: string } | { file: string };

interface Input {
  outcome: Report["outcome"];
  summary: Summary;
  plan?: string;
}

type Failed = { error: string };

function textOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The summary the flags name: exactly one of --summary and --file, and a non-empty --summary. */
function summaryOption(
  text: string | undefined,
  file: string | undefined,
): Summary | Failed {
  if (text !== undefined && file === undefined) {
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
  return { outcome, summary, ...(plan === undefined ? {} : { plan }) };
}

/** A file's text, or why it cannot be read. */
async function readText(
  deps: CliDeps,
  label: string,
  path: string,
): Promise<{ text: string } | Failed> {
  if (!(await deps.fs.exists(path))) {
    return { error: `${label} does not exist.` };
  }
  return { text: await deps.fs.readFile(path) };
}

/** The summary text: the flag's own text, or a file that must sit under the report directory. */
async function summaryText(
  deps: CliDeps,
  cwd: string,
  summary: Summary,
): Promise<{ text: string } | Failed> {
  if ("text" in summary) {
    return summary;
  }
  const path = resolve(deps.cwd, summary.file);
  if (!(await isInsideReportDir(deps.fs, deps.links, cwd, path))) {
    return {
      error: `--file ${summary.file} is outside ${reportDirOf(cwd)}; a report reads its summary only from there. Write the summary file in that directory and pass it again.`,
    };
  }
  return readText(deps, `--file ${summary.file}`, path);
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
  if (routed.backend === "herdr") {
    return {
      error: `Session ${record.name} runs on herdr; session report is for hc sessions only.`,
    };
  }
  return record;
}

/** The summary, and the plan's text when the flags name one, or why either cannot be read. */
async function contentOf(
  deps: CliDeps,
  cwd: string,
  input: Input,
): Promise<{ summary: string; plan?: string } | Failed> {
  const summary = await summaryText(deps, cwd, input.summary);
  if ("error" in summary) {
    return summary;
  }
  if (input.plan === undefined) {
    return { summary: summary.text };
  }
  const plan = await readText(
    deps,
    `--plan ${input.plan}`,
    resolve(deps.cwd, input.plan),
  );
  return "error" in plan ? plan : { summary: summary.text, plan: plan.text };
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
