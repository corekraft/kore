import { JudgeError, precheck, summary, type Report } from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { checklistModes } from "./judge-checklist.js";
import {
  FAILED,
  failed,
  prNumber,
  record,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";

const APPROVE_USAGE =
  "Run `harness judge approve <pr> [--json] [--reviewer <login>[,<login>]]`.";

/** What the approval needs from the PR: who wrote it, its head now, and who approved which commit. */
interface Standing {
  author: string;
  head: string;
  approvals: { login: string; commit: string }[];
}

const record_ = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Runs gh with the pane's own environment (its GH_TOKEN) and returns stdout, or fails naming the step. */
async function gh(
  context: CommandContext,
  root: string,
  args: string[],
  what: string,
  pr: number,
): Promise<string> {
  const done = await context.deps.runner.run("gh", args, { cwd: root });
  if (done.code !== 0) {
    throw new JudgeError(
      `${what} failed for PR #${pr}: ${done.stderr.trim()}. Check \`gh auth status\` and the PR number, then rerun \`harness judge approve ${pr}\`.`,
    );
  }
  return done.stdout;
}

function parseStanding(stdout: string, pr: number): Standing {
  let view: Record<string, unknown>;
  try {
    view = record_(JSON.parse(stdout));
  } catch {
    throw new JudgeError(
      `gh returned unreadable output for PR #${pr}. ${APPROVE_USAGE}`,
    );
  }
  const reviews = Array.isArray(view["reviews"]) ? view["reviews"] : [];
  return {
    author: text(record_(view["author"])["login"]),
    head: text(view["headRefOid"]),
    approvals: reviews
      .map(record_)
      .filter((r) => r["state"] === "APPROVED")
      .map((r) => ({
        login: text(record_(r["author"])["login"]),
        commit: text(record_(r["commit"])["oid"]),
      })),
  };
}

/** The PR's author, head and approvals as GitHub holds them now. */
async function standingOf(
  context: CommandContext,
  root: string,
  repo: string,
  pr: number,
): Promise<Standing> {
  const out = await gh(
    context,
    root,
    [
      "pr",
      "view",
      String(pr),
      "--repo",
      repo,
      "--json",
      "author,headRefOid,reviews",
    ],
    "gh pr view",
    pr,
  );
  return parseStanding(out, pr);
}

function refuseUnverified(context: CommandContext, report: Report): number {
  const { deps, json } = context;
  deps.stdout(
    json
      ? `${JSON.stringify({ ...report, approved: false })}\n`
      : summary(report),
  );
  deps.stderr(
    `PR #${report.pr} was not approved: the precheck did not pass. Fix what it reports, or send the change back with \`harness judge send-back ${report.pr} --reason <why>\`.\n`,
  );
  return FAILED;
}

/**
 * Re-runs the precheck and, only when it passes, approves the commit it verified with the
 * pane's own gh identity (never overridden). The only review a judge pane may post: it
 * refuses a head that moved since the verdict and the caller's own PR, and posts nothing
 * again when the caller's approval already covers the head.
 */
async function runApprove(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand, APPROVE_USAGE);
    const root = await deps.root();
    const repo = await repoOf(context);
    const report = await precheck(
      context,
      root,
      repo,
      pr,
      await reviewersOf(context, repo),
      await checklistModes(context),
    );
    await record(context, report);
    const verified = report.head;
    if (!report.ok || verified === undefined || verified === "") {
      return refuseUnverified(context, report);
    }
    const caller = (
      await gh(
        context,
        root,
        ["api", "user", "--jq", ".login"],
        "gh api user",
        pr,
      )
    ).trim();
    const standing = await standingOf(context, root, repo, pr);
    if (standing.head !== verified) {
      throw new JudgeError(
        `The head of PR #${pr} moved from ${verified} to ${standing.head} after the precheck verified it. Rerun \`harness judge approve ${pr}\` to verify the new commit.`,
      );
    }
    if (caller === "") {
      throw new JudgeError(
        `gh could not report the login this pane runs as. Run \`gh auth status\` to check the pane's GH_TOKEN, then rerun \`harness judge approve ${pr}\`.`,
      );
    }
    if (standing.author === caller) {
      throw new JudgeError(
        `PR #${pr} is authored by ${standing.author}, the login this pane runs as, and nobody approves their own change. Let a different judge identity approve it.`,
      );
    }
    const already = standing.approvals.some(
      (a) => a.login === caller && a.commit === verified,
    );
    if (!already) {
      await gh(
        context,
        root,
        ["pr", "review", String(pr), "--repo", repo, "--approve"],
        "gh pr review",
        pr,
      );
    }
    deps.stdout(
      json
        ? `${JSON.stringify({ pr, approved: true, head: verified, already })}\n`
        : `PR #${pr}: ${already ? "already " : ""}approved at ${verified}\n`,
    );
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

export const approveCommands: Record<string, Command> = {
  approve: {
    summary:
      "mutates; re-runs the precheck and approves the verified head commit as the pane's own gh identity only when it passes; refuses a moved head and the caller's own PR, and posts nothing twice (<pr> [--json] [--reviewer <login>[,<login>]])",
    operand: "pr",
    options: { reviewer: "string" },
    run: runApprove,
  },
};
