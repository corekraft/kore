import type { Command, CommandContext } from "../runtime/index.js";
import { precheck, summary } from "../judge/index.js";
import {
  FAILED,
  failed,
  prNumber,
  record,
  reviewersOf,
} from "./judge-shared.js";
import { mergeCommands } from "./judge-merge-commands.js";

const USAGE =
  "Run `harness judge precheck <pr> [--json] [--reviewer <login>[,<login>]]`.";

async function runPrecheck(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand, USAGE);
    const root = await deps.root();
    const report = await precheck(context, root, pr, reviewersOf(context));
    deps.stdout(json ? `${JSON.stringify(report)}\n` : summary(report));
    await record(context, report);
    return report.ok ? 0 : FAILED;
  } catch (error) {
    return failed(context, error);
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
  ...mergeCommands,
};
