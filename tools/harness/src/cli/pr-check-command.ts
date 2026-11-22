import { authorCheck, JudgeError, type AuthorCheck } from "../judge/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import {
  checkedPrecheck,
  FAILED,
  failed,
  openJudgeLedger,
  prNumber,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";

const USAGE = "Run `harness pr check <pr> [--json]`.";

const IDEA = /^[\w.:/#@-]{1,128}$/;

/** What the writer reads: the failures it owns to fix, and the pending items the judge waits on. */
function render(view: AuthorCheck): string {
  const pending =
    view.pending.length === 0
      ? ""
      : `pending, the judge waits on these: ${view.pending.join(", ")}\n`;
  // An audit item is shown with its file, its count and its fix, and is never a failure.
  const audits = (view.audits ?? [])
    .map(
      (a) =>
        `audit: ${a.item} ${a.file}${a.line === undefined ? "" : `:${a.line}`}: ${a.detail}; fix: ${a.fix}; reported, not sent back\n`,
    )
    .join("");
  if (view.failures.length === 0) {
    return view.pending.length === 0
      ? `PR #${view.pr}: ready for the judge\n${audits}`
      : `PR #${view.pr}: nothing for you to fix\n${pending}${audits}`;
  }
  const lines = view.failures
    .map(
      (f) =>
        `  ${f.category}: ${f.item}${f.detail === undefined ? "" : ` (${f.detail})`}\n`,
    )
    .join("");
  return `PR #${view.pr}: fix these, push, then run harness pr check once more\n${lines}${pending}${audits}`;
}

/**
 * Appends one pr.checked event at the shared ledger, naming the failure categories it found
 * ("none" when it found none). It never records a send-back: the check is the writer's own.
 */
async function recordChecked(
  context: CommandContext,
  idea: string | undefined,
  view: AuthorCheck,
): Promise<void> {
  const ledger = await openJudgeLedger(context);
  const categories = [...new Set(view.failures.map((f) => f.category))];
  const event = await ledger.record({
    source: "github",
    kind: "pr.checked",
    occurredAt: context.deps.clock.now().toISOString(),
    number: view.pr,
    label: categories.length === 0 ? "none" : categories.join(","),
    ...(idea !== undefined && IDEA.test(idea) ? { idea } : {}),
  });
  if (!event.ok) {
    throw new JudgeError(
      `The check ran, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness pr check ${view.pr}\`.`,
    );
  }
}

/**
 * `harness pr check <pr>`: the judge's precheck, read the way the writer must act on it. Exits 0
 * when no failure the writer owns remains (pending CI or review is listed, not failed) and 1 when
 * one does. Reads the same report the judge reads; records one pr.checked event.
 */
export async function prCheckRun(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand, USAGE);
    const root = await deps.root();
    const repo = await repoOf(context);
    const report = await checkedPrecheck(
      context,
      root,
      repo,
      pr,
      await reviewersOf(context, repo),
    );
    const view = authorCheck(report);
    await recordChecked(context, report.idea, view);
    deps.stdout(json ? `${JSON.stringify(view)}\n` : render(view));
    return view.ok ? 0 : FAILED;
  } catch (error) {
    return failed(context, error);
  }
}

const checkHelp: CommandHelp = {
  purpose:
    "Checks a pull request the way its writer must act on the judge's precheck: prints the failures the writer owns to fix and the pending items the judge waits on, and records one pr.checked event.",
  when: "After a push to a PR you opened, once its checks have run, to see which failures are yours to fix.",
  whenNot:
    "When you only need the CI state: use pr checks. This check never sends a change back.",
  flags: {},
  operand: "The pull request number, such as 746.",
  examples: [
    {
      command: "harness pr check 746",
      shows:
        "either that the PR is ready for the judge, that nothing is for the writer while CI or review is pending, or the failures to fix with their categories",
    },
    {
      command: "harness pr check 746 --json",
      shows:
        "the same result as one object, with the failures and the pending items",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "no failure the writer owns remains; pending CI or review is listed, not failed",
    },
    {
      code: 1,
      meaning:
        "a failure the writer owns remains, or the check could not run: no PR number, a gh read failed, or the ledger event was rejected",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "appends one pr.checked event to the shared ledger naming the failure categories, or none; it never records a send-back and changes nothing on the PR",
  },
  seeAlso: ["pr checks", "pr open", "judge precheck"],
};

export const prCheckCommand: Command = {
  summary:
    "Shows the failures a pull request's writer must fix, and what the judge still waits on.",
  operand: "pr",
  help: checkHelp,
  run: prCheckRun,
};
