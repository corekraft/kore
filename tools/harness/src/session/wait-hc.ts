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

/** The error a wait that ran out of bound gives: still working, with the commands that look again. */
function stillWorking(
  name: string,
  terminal: string,
  timeoutMs: number,
): { error: string } {
  return {
    error: `Session ${name} is still working: no report and no stop within ${timeoutMs / 1000} seconds. Run session wait ${name} again, or read the terminal with hc read ${terminal}.`,
  };
}

/** What one wait on an hc session reads and settles through, passed to its steps as one value. */
interface Settling {
  deps: WaitDeps;
  terminals: Terminals;
  registry: Pick<SessionRegistry, "write">;
  record: SessionRecord;
  /** The terminal's checkout, where its report file is. */
  cwd: string;
  terminal: string;
}

/**
 * Settles the wait when a report is there or the terminal is blocked, at any point before it finishes:
 * before the first wait, after a wake, or after an early timeout. Otherwise undefined, and the wait goes on.
 */
async function settleWoken(
  s: Settling,
): Promise<ReportWait | { error: string } | undefined> {
  const fresh = await unread(s.deps, s.cwd, s.record);
  if (fresh !== undefined) {
    return consume(s.registry, s.record, fresh);
  }
  const now = await s.terminals.get(s.terminal);
  if ("error" in now) {
    return failure(s.record.name, now);
  }
  return isBlocked(now.status)
    ? await blockedByStatus(s.deps, s.registry, s.record, now.status)
    : undefined;
}

/**
 * Waits for the terminal to finish. A message's wake, or an hc timeout that came before the bound, is
 * not the finish: the wait settles on a report or a blocked status, else waits again on the bound left.
 * Returns undefined once the terminal finished, or how the wait settled.
 */
async function waitForFinish(
  s: Settling,
  timeoutMs: number,
): Promise<ReportWait | { error: string } | undefined> {
  const deadline = s.deps.clock.now().getTime() + timeoutMs;
  let waited = await s.terminals.wait({ terminal: s.terminal }, timeoutMs);
  while (
    "error" in waited &&
    (waited.error.kind === "woke" || waited.error.kind === "timeout")
  ) {
    const settled = await settleWoken(s);
    if (settled !== undefined) {
      return settled;
    }
    const left = deadline - s.deps.clock.now().getTime();
    if (left <= 0) {
      return stillWorking(s.record.name, s.terminal, timeoutMs);
    }
    waited = await s.terminals.wait({ terminal: s.terminal }, left);
  }
  return "error" in waited ? failure(s.record.name, waited) : undefined;
}

/**
 * Settles an hc session by its report, never by the pane. A report with a new seq is done or blocked
 * as it says. Blocked or error status is blocked at once. A stopped terminal with no unread report is
 * blocked, stopped without a report. Only a report makes done. A message wakes hc's wait without a
 * finish, and a timeout can come early: either one waits again on the bound left, and the bound ends it.
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
  const s: Settling = {
    deps,
    terminals,
    registry,
    record,
    cwd: view.cwd,
    terminal,
  };
  const early = await settleWoken(s);
  if (early !== undefined) {
    return early;
  }
  const settled = await waitForFinish(s, timeoutMs);
  if (settled !== undefined) {
    return settled;
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

/**
 * Looks at an hc session once and never waits (harness wait's read of each target): a report with a new seq, or a
 * blocked or error status, settles it; a terminal that stopped with no report is blocked; anything else is still
 * pending, which is undefined.
 */
export async function readSettledOnce(
  deps: WaitDeps,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
): Promise<ReportWait | { error: string } | undefined> {
  if (record.terminal === undefined) {
    return {
      error: `Session ${record.name} has no hc terminal recorded; start it again with session spawn.`,
    };
  }
  const view = await terminals.get(record.terminal);
  if ("error" in view) {
    return failure(record.name, view);
  }
  const settled = await settleWoken({
    deps,
    terminals,
    registry,
    record,
    cwd: view.cwd,
    terminal: record.terminal,
  });
  if (settled !== undefined || view.state !== "finished") {
    return settled;
  }
  await settleStopped(deps, registry, record);
  return blocked(record, "stopped without a report");
}

/** The line `session wait` prints for an hc session: name, model, outcome and summary. */
export function formatReportWait(result: ReportWait): string {
  return `${result.name} (${result.model}) ${result.outcome}: ${result.summary}\n`;
}
