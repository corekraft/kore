import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
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

/** `harness pr open`: opens a PR whose body carries the declaration the precheck parses. */
export { prCommands } from "./pr-commands.js";

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

const precheckHelp: CommandHelp = {
  purpose:
    "Reads a PR's verdict for the judge: its declared safety pattern, the pattern hints from its diff, and its CI, scan, coverage and principles-review results, each checklist item under the mode its rule sets in .claude/guardrails.yaml. It fails when no single valid pattern is declared or a check is not passing. An audit item that fails is listed and logged and never makes the verdict not ready; an enforce item that fails does.",
  when: "The judge pane runs it on a PR before approving or merging it, and again after each new push to the head, since a verdict is for one head.",
  whenNot:
    "When you need the change itself, use judge diff; when only the PR body is to be checked, use judge declaration; when you are the writer checking your own gates, use pr check.",
  flags: {
    reviewer:
      "A login, or several separated by commas, whose principles-review verdicts count; it replaces the reviewerLogins of .claude/harness.json, and without it those logins, else the repository owner's, are used; only a verdict made after the head commit counts.",
  },
  operand: "The pull request number, a positive whole number.",
  examples: [
    {
      command: "harness judge precheck 942",
      shows:
        "PR 942's pattern, hints and each gate's result, with ok when every enforced gate passes",
    },
    {
      command: "harness judge precheck 942 --json",
      shows: "the same verdict as one JSON object, for a script to read",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the verdict passed: one valid pattern is declared and every enforced gate passes",
    },
    {
      code: 1,
      meaning:
        "the verdict did not pass, or the command was refused: a missing or invalid PR number, a harness bundle behind origin/main, an unreadable guardrail inventory, a mode other than audit or enforce, or an unreadable harness config, or a rejected ledger event; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, a second operand, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "reads GitHub and the checkout only, and appends to the shared ledger: one precheck event when the PR's verdict differs from its newest, and one guard.audit event per failing audit item at each head; nothing on GitHub changes",
  },
  seeAlso: [
    "judge diff",
    "judge declaration",
    "judge approve",
    "judge merge",
    "judge send-back",
  ],
};

const precheckCommand: Command = {
  summary: "read a PR's verdict: its declared pattern and every gate's result",
  operand: "pr",
  options: { reviewer: "string" },
  help: precheckHelp,
  run: runPrecheck,
};

export const judgeCommands: Record<string, Command> = {
  precheck: precheckCommand,
  ...declarationCommands,
  ...diffCommands,
  ...approveCommands,
  ...mergeCommands,
};
