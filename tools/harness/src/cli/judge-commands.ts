import { resolve } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  bundleMainRoot,
  type Command,
  type CommandContext,
} from "../runtime/index.js";
import { JudgeError, precheck, summary, type Report } from "../judge/index.js";

const FAILED = 1;
const USAGE =
  "Run `harness judge precheck <pr> [--json] [--reviewer <login>[,<login>]]`.";

function prNumber(operand: string | undefined): number {
  if (operand === undefined || !/^\d+$/.test(operand) || Number(operand) < 1) {
    throw new JudgeError(`Missing or invalid PR number. ${USAGE}`);
  }
  return Number(operand);
}

/**
 * The shared ledger of the checkout that holds this bundle. The judge may not choose it:
 * KORE_ROOT, CLAUDE_PROJECT_DIR and any --ledger are ignored or refused.
 */
async function openJudgeLedger({ deps }: CommandContext): Promise<Ledger> {
  const main = await bundleMainRoot(deps);
  if (main === undefined) {
    throw new JudgeError(
      "Cannot find the main checkout from the harness bundle's location, so there is no ledger to record to. Run the committed skills/bin/harness.mjs from inside the repository.",
    );
  }
  return new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    resolve(main, DEFAULT_LEDGER),
  );
}

async function record(context: CommandContext, report: Report): Promise<void> {
  const ledger = await openJudgeLedger(context);
  const { deps } = context;
  const idea = report.idea;
  const label = `${report.pattern ?? "none"}:${report.ok ? "pass" : "fail"}`;
  const logged = await ledger.list({ kind: "precheck" });
  const newest = logged.events.filter((e) => e.number === report.pr).at(-1);
  // Only a change from the PR's newest verdict is news; pass, fail, pass records all three.
  if (newest?.label === label) {
    return;
  }
  const event = await ledger.record({
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
    const reviewers = String(context.options["reviewer"] ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r !== "");
    const report = await precheck(context, root, pr, reviewers);
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
    "read-only on GitHub; report a PR's declared safety pattern, pattern hints from its diff, and its CI, scan, coverage and principles-review results; fails when no single valid pattern is declared or a check is not passing; records a precheck ledger event at the shared ledger; principles-review counts only from a named reviewer, made after the head commit (<pr> [--reviewer <login>[,<login>]])",
  operand: "pr",
  options: { reviewer: "string" },
  run: runPrecheck,
};

export const judgeCommands: Record<string, Command> = {
  precheck: precheckCommand,
};
