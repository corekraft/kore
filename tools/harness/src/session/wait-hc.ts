import type { CliDeps } from "../runtime/index.js";
import type { Status, TerminalError, Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import { readReport, reportPath, type Report } from "./report-file.js";

/** The last lines of a stopped terminal's output a blocked wait shows. */
export const READ_LINES = 40;

/** What `session wait` settles on for an hc session: a report's outcome, or blocked with its reason. */
export interface ReportWait {
  name: string;
  model: string;
  outcome: "done" | "blocked";
  summary: string;
  /** The seq of the report the wait consumed; absent when it settled without one. */
  seq?: number;
}

type WaitDeps = Pick<CliDeps, "fs" | "clock">;

function isBlocked(status: Status | undefined): status is "blocked" | "error" {
  return status === "blocked" || status === "error";
}

function failure(name: string, error: TerminalError): { error: string } {
  return { error: `Session ${name}: ${hcMessage(error)}` };
}

function blocked(record: SessionRecord, summary: string): ReportWait {
  return {
    name: record.name,
    model: record.model,
    outcome: "blocked",
    summary,
  };
}

/** The report in the terminal's checkout, when its seq is above the last one this wait consumed. */
async function unread(
  deps: WaitDeps,
  cwd: string,
  record: SessionRecord,
): Promise<Report | undefined> {
  const report = await readReport(deps.fs, reportPath(cwd, record.name));
  return report !== undefined && report.seq > (record.reportSeq ?? 0)
    ? report
    : undefined;
}

/** Records the report's seq as consumed, and settles on its outcome. */
async function consume(
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  report: Report,
): Promise<ReportWait> {
  await registry.write({
    ...record,
    reportSeq: report.seq,
    result: { outcome: report.outcome, summary: report.summary, at: report.at },
  });
  return {
    name: record.name,
    model: record.model,
    outcome: report.outcome,
    summary: report.summary,
    seq: report.seq,
  };
}

/**
 * A stop with no report ever consumed is an outcome: blocked, kept as the record's result so the record settles and
 * close can accept it. A record that already consumed a report keeps the outcome it has.
 */
async function settleStopped(
  deps: WaitDeps,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  summary = "stopped without a report",
): Promise<void> {
  if (record.result !== undefined || record.reportSeq !== undefined) {
    return;
  }
  await registry.write({
    ...record,
    result: {
      outcome: "blocked",
      summary,
      at: deps.clock.now().toISOString(),
    },
  });
}

/** Blocked or error status is an outcome: it settles blocked and is recorded, so close accepts it as it does a stop. */
async function blockedByStatus(
  deps: WaitDeps,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  status: "blocked" | "error",
): Promise<ReportWait> {
  const summary = `reported ${status} and wrote no report`;
  await settleStopped(deps, registry, record, summary);
  return blocked(record, summary);
}

/** After a wait that ran out: blocked when the terminal turned blocked meanwhile, else still working. */
async function afterTimeout(
  deps: WaitDeps,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  timeoutMs: number,
): Promise<ReportWait | { error: string }> {
  const { name } = record;
  const terminal = record.terminal ?? "";
  const now = await terminals.get(terminal);
  if ("error" in now) {
    return failure(name, now);
  }
  if (isBlocked(now.status)) {
    return await blockedByStatus(deps, registry, record, now.status);
  }
  return {
    error: `Session ${name} is still working: no report and no stop within ${timeoutMs / 1000} seconds. Run session wait ${name} again, or read the terminal with hc read ${terminal}.`,
  };
}

/**
 * Settles an hc session by its report, never by the pane. A report with a new seq is done or blocked
 * as it says. Blocked or error status is blocked at once. A stopped terminal with no unread report is
 * blocked, stopped without a report. Only a report makes done.
 */
export async function waitForReport(
  deps: WaitDeps,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  timeoutMs: number,
): Promise<ReportWait | { error: string }> {
  const { name } = record;
  if (record.terminal === undefined) {
    return {
      error: `Session ${name} has no hc terminal recorded; start it again with session spawn.`,
    };
  }
  const terminal = record.terminal;
  const view = await terminals.get(terminal);
  if ("error" in view) {
    return failure(name, view);
  }
  const fresh = await unread(deps, view.cwd, record);
  if (fresh !== undefined) {
    return consume(registry, record, fresh);
  }
  if (isBlocked(view.status)) {
    return await blockedByStatus(deps, registry, record, view.status);
  }
  const waited = await terminals.wait({ terminal }, timeoutMs);
  if ("error" in waited) {
    return waited.error.kind === "timeout"
      ? afterTimeout(deps, terminals, registry, record, timeoutMs)
      : failure(name, waited);
  }
  const after = await unread(deps, view.cwd, record);
  if (after !== undefined) {
    return consume(registry, record, after);
  }
  const last = await terminals.read(terminal, READ_LINES);
  if ("error" in last) {
    return failure(name, last);
  }
  await settleStopped(deps, registry, record);
  return blocked(
    record,
    last.text === ""
      ? "stopped without a report"
      : `stopped without a report\n${last.text}`,
  );
}

/** The line `session wait` prints for an hc session: name, model, outcome and summary. */
export function formatReportWait(result: ReportWait): string {
  return `${result.name} (${result.model}) ${result.outcome}: ${result.summary}\n`;
}
