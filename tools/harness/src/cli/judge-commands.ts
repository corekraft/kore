import { openLedger } from "./ledger-commands.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { JudgeError, precheck, summary, type Report } from "../judge/index.js";

const FAILED = 1;
const USAGE = "Run `harness judge precheck <pr> [--json] [--ledger <path>]`.";

function prNumber(operand: string | undefined): number {
  if (operand === undefined || !/^\d+$/.test(operand) || Number(operand) < 1) {
    throw new JudgeError(`Missing or invalid PR number. ${USAGE}`);
  }
  return Number(operand);
}

async function record(context: CommandContext, report: Report): Promise<void> {
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new JudgeError(opened.error);
  }
  const { deps } = context;
  const idea = report.idea;
  const label = `${report.pattern ?? "none"}:${report.ok ? "pass" : "fail"}`;
  const logged = await opened.ledger.list({ kind: "precheck" });
  // A rerun with the same verdict on the same PR adds nothing.
  if (logged.events.some((e) => e.number === report.pr && e.label === label)) {
    return;
  }
  const event = await opened.ledger.record({
    source: "github",
    kind: "precheck",
    occurredAt: deps.clock.now().toISOString(),
    number: report.pr,
    label,
    ...(idea !== undefined && /^[\w.:/#@-]{1,128}$/.test(idea) ? { idea } : {}),
  });
  if (!event.ok) {
    throw new JudgeError(
      `The precheck ran, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness judge precheck ${report.pr}\`.`,
    );
  }
}

async function runPrecheck(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand);
    const root = await deps.root();
    const report = await precheck(context, root, pr);
    deps.stdout(json ? `${JSON.stringify(report)}\n` : summary(report));
    await record(context, report);
    return report.ok ? 0 : FAILED;
  } catch (error) {
    if (!(error instanceof JudgeError)) {
      throw error;
    }
    deps.stderr(
      `${json ? `${JSON.stringify({ error: error.message })}\n` : ""}${error.message}\n`,
    );
    return FAILED;
  }
}

const precheckCommand: Command = {
  summary:
    "read-only on GitHub; report a PR's declared safety pattern, pattern hints from its diff, and its CI, scan, coverage and principles-review results; fails when no single valid pattern is declared or a check is not passing; records a precheck ledger event (<pr> [--ledger])",
  operand: "pr",
  options: { ledger: "string" },
  run: runPrecheck,
};

export const judgeCommands: Record<string, Command> = {
  precheck: precheckCommand,
};
