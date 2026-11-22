import { JudgeError, summary, type Report } from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { signedBody } from "../sender/index.js";
import { approveHelp } from "./judge-approve-help.js";
import {
  FAILED,
  failed,
  prNumber,
  record,
  repoOf,
  reviewersOf,
  checkedPrecheck,
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

/**
 * One spelling per identity. gh names a GitHub App `app/<slug>` as a PR author,
 * `<slug>` as a reviewer, and GraphQL's viewer calls it `<slug>[bot]`.
 */
const loginOf = (value: unknown): string =>
  text(value)
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");

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
    author: loginOf(record_(view["author"])["login"]),
    head: text(view["headRefOid"]),
    approvals: reviews
      .map(record_)
      .filter((r) => r["state"] === "APPROVED")
      .map((r) => ({
        login: loginOf(record_(r["author"])["login"]),
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
    `PR #${report.pr} was not approved: the precheck did not pass. Fix what it reports, or send the change back with \`harness judge send-back ${report.pr} --reason <why> --category <category>\`.\n`,
  );
  return FAILED;
}

/** The sender line the approval review carries, or a refusal when the environment cannot name the sender. */
function senderLineOf({ deps }: CommandContext): string {
  const line = signedBody(deps.env, "judge approve", "");
  if ("error" in line) {
    throw new JudgeError(line.error);
  }
  return line.body;
}

/** Refuses a head that moved since the precheck verified it, and the caller's own PR. */
function assertCanApprove(
  standing: Standing,
  verified: string,
  caller: string,
  pr: number,
): void {
  if (standing.head !== verified) {
    throw new JudgeError(
      `The head of PR #${pr} moved from ${verified} to ${standing.head} after the precheck verified it. Rerun \`harness judge approve ${pr}\` to verify the new commit.`,
    );
  }
  if (standing.author === caller) {
    throw new JudgeError(
      `PR #${pr} is authored by ${standing.author}, the login this pane runs as, and nobody approves their own change. Let a different judge identity approve it.`,
    );
  }
}

/**
 * The login this pane's gh runs as; refused when gh cannot report one. GraphQL's
 * viewer answers for a person's token and a GitHub App's installation token alike;
 * REST /user refuses the App with 403.
 */
async function callerOf(
  context: CommandContext,
  root: string,
  pr: number,
): Promise<string> {
  const caller = loginOf(
    (
      await gh(
        context,
        root,
        [
          "api",
          "graphql",
          "--field",
          "query={viewer{login}}",
          "--jq",
          ".data.viewer.login",
        ],
        "gh api graphql viewer",
        pr,
      )
    ).trim(),
  );
  if (caller === "") {
    throw new JudgeError(
      `gh could not report the login this pane runs as. Run \`gh auth status\` to check the pane's GH_TOKEN, then rerun \`harness judge approve ${pr}\`.`,
    );
  }
  return caller;
}

/** Approves the verified head as the pane's own identity, its sender line as the review's body. */
async function approveReview(
  context: CommandContext,
  root: string,
  repo: string,
  pr: number,
  body: string,
): Promise<void> {
  await gh(
    context,
    root,
    ["pr", "review", String(pr), "--repo", repo, "--approve", "--body", body],
    "gh pr review",
    pr,
  );
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
    const body = senderLineOf(context);
    const root = await deps.root();
    const repo = await repoOf(context);
    const report = await checkedPrecheck(
      context,
      root,
      repo,
      pr,
      await reviewersOf(context, repo),
    );
    await record(context, report);
    const verified = report.head;
    if (!report.ok || verified === undefined || verified === "") {
      return refuseUnverified(context, report);
    }
    const caller = await callerOf(context, root, pr);
    const standing = await standingOf(context, root, repo, pr);
    assertCanApprove(standing, verified, caller, pr);
    const already = standing.approvals.some(
      (a) => a.login === caller && a.commit === verified,
    );
    if (!already) {
      await approveReview(context, root, repo, pr, body);
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
    help: approveHelp,
    run: runApprove,
  },
};
