import type { Command, CommandContext } from "../runtime/index.js";
import { summary } from "../judge/index.js";
import {
  FAILED,
  failed,
  prNumber,
  record,
  repoOf,
  reviewersOf,
  checkedPrecheck,
} from "./judge-shared.js";
import { requireFreshBundle } from "./judge-freshness.js";
import { declarationCommands } from "./judge-declaration-command.js";
import { diffCommands } from "./judge-diff-command.js";
import { approveCommands } from "./judge-approve-command.js";
import { mergeCommands } from "./judge-merge-commands.js";

/** `harness review post`: the principles-review verdict, in the format the judge's precheck reads. */
export { reviewCommands } from "./review-commands.js";

const USAGE =
  "Run `harness judge precheck <pr> [--json] [--reviewer <login>[,<login>]]`.";

async function runPrecheck(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand, USAGE);
    const root = await deps.root();
    const repo = await repoOf(context);
    await requireFreshBundle(context, root, repo);
    const report = await checkedPrecheck(
      context,
      root,
      repo,
      pr,
      await reviewersOf(context, repo),
    );
    deps.stdout(json ? `${JSON.stringify(report)}\n` : summary(report));
    await record(context, report);
    return report.ok ? 0 : FAILED;
  } catch (error) {
    return failed(context, error);
  }
}

const precheckCommand: Command = {
  summary:
    "read-only on GitHub; report a PR's declared safety pattern, pattern hints from its diff, and its CI, scan, coverage and principles-review results; fails when no single valid pattern is declared or a check is not passing; fails fast, naming the fix, when this harness bundle is behind origin/main for tools/harness (compared through the GitHub compare API; only a warning when the comparison is impossible); records a precheck ledger event at the shared ledger; each checklist item reads its mode from .claude/guardrails.yaml (rule judge-<item>, kind checklist; ci, scan, coverage, principles-review, expand-step, pattern-match): an audit item that fails is listed under audited in --json and never makes the report not ready, and writes one guard.audit ledger event per item and head, while an enforce item that fails does; an unreadable inventory or a mode other than audit or enforce is refused; principles-review counts only from the reviewers it names (reviewerLogins in .claude/harness.json, else the owner login; --reviewer <login>[,<login>] overrides both), made after the head commit (<pr> [--reviewer <login>[,<login>]])",
  operand: "pr",
  options: { reviewer: "string" },
  run: runPrecheck,
};

export const judgeCommands: Record<string, Command> = {
  precheck: precheckCommand,
  ...declarationCommands,
  ...diffCommands,
  ...approveCommands,
  ...mergeCommands,
};
