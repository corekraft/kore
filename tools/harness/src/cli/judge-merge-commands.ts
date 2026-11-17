import {
  JudgeError,
  hasSentBack,
  readPr,
  sendBackBody,
  summary,
  type ItemVerdict,
} from "../judge/index.js";
import {
  SEND_BACK_CATEGORIES,
  type SendBackCategory,
} from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { signedBody } from "../sender/index.js";
import {
  FAILED,
  failed,
  openJudgeLedger,
  prNumber,
  record,
  repoOf,
  reviewersOf,
  checkedPrecheck,
} from "./judge-shared.js";

const MERGE_USAGE =
  "Run `harness judge merge <pr> [--json] [--reviewer <login>[,<login>]]`.";
const SEND_BACK_USAGE =
  'Run `harness judge send-back <pr> --reason "<why>" --category <category>`.';
const CATEGORY_LIST = SEND_BACK_CATEGORIES.join(", ");
const LABEL_MAX = 100;

/** The category the judge gave, or a refusal that names the whole list. */
function categoryOf(value: string | boolean | undefined): SendBackCategory {
  if (value === undefined || value === "" || value === true) {
    throw new JudgeError(
      `A send-back needs a --category. Use one of: ${CATEGORY_LIST}. ${SEND_BACK_USAGE}`,
    );
  }
  const found = SEND_BACK_CATEGORIES.find((c) => c === value);
  if (found === undefined) {
    throw new JudgeError(
      `"${value}" is not a send-back category. Use one of: ${CATEGORY_LIST}. ${SEND_BACK_USAGE}`,
    );
  }
  return found;
}

/** One line per audit gate that failed and so was logged, never a reason to hold the merge. */
function auditLines(audited: readonly ItemVerdict[]): string {
  return audited
    .map(
      (a) =>
        `audit: ${a.item} ${a.result}${a.detail === undefined || a.detail === "" ? "" : ` (${a.detail})`}; logged, did not block the merge\n`,
    )
    .join("");
}

/** The merge state GitHub reports for the PR, or undefined when it cannot be read; read only after a refused merge. */
async function mergeStateOf(
  context: CommandContext,
  root: string,
  repo: string,
  pr: number,
): Promise<string | undefined> {
  const done = await context.deps.runner.run(
    "gh",
    ["pr", "view", String(pr), "--repo", repo, "--json", "mergeStateStatus"],
    { cwd: root },
  );
  if (done.code !== 0) {
    return undefined;
  }
  try {
    const state = (JSON.parse(done.stdout) as { mergeStateStatus?: unknown })
      .mergeStateStatus;
    return typeof state === "string" ? state : undefined;
  } catch {
    return undefined;
  }
}

/** The refusal for a PR behind main: it names the PR, the state and the next step that exists today. */
function behindMessage(pr: number): string {
  return `PR #${pr} was not merged: its branch is behind main. Next step: the orchestrator tells the writer to merge origin/main into its branch (never rebase or force-push), or run \`gh pr update-branch ${pr}\`; then rerun \`harness judge merge ${pr}\` once its checks pass.`;
}

/**
 * Re-runs the precheck and squash-merges the commit it verified, only when every
 * result passes. The only merge a role-bound pane may run; it never picks another
 * strategy, and `--match-head-commit` refuses a head that moved after the verdict.
 */
async function runMerge(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand, MERGE_USAGE);
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
    if (!report.ok || report.head === undefined || report.head === "") {
      deps.stdout(
        json
          ? `${JSON.stringify({ ...report, merged: false })}\n`
          : summary(report),
      );
      deps.stderr(
        `PR #${pr} was not merged: the precheck did not pass. Fix what it reports, or send the change back with \`harness judge send-back ${pr} --reason <why> --category <category>\`.\n`,
      );
      return FAILED;
    }
    const done = await deps.runner.run(
      "gh",
      [
        "pr",
        "merge",
        String(pr),
        "--repo",
        repo,
        "--squash",
        "--match-head-commit",
        report.head,
      ],
      { cwd: root },
    );
    if (done.code !== 0) {
      if ((await mergeStateOf(context, root, repo, pr)) === "BEHIND") {
        throw new JudgeError(behindMessage(pr));
      }
      throw new JudgeError(
        `gh pr merge failed for PR #${pr}: ${done.stderr.trim()}. If the head moved, rerun \`harness judge merge ${pr}\` to verify the new commit.`,
      );
    }
    const audited = report.audited ?? [];
    deps.stdout(
      json
        ? `${JSON.stringify({ pr, merged: true, head: report.head, ...(audited.length === 0 ? {} : { audited }) })}\n`
        : `PR #${pr}: squash-merged at ${report.head}\n${auditLines(audited)}`,
    );
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

/** The ledger label for a reason on a head: one line, no control characters, within 100 characters, ending in `@<head>`. */
function labelFor(reason: string, head: string): string {
  const tail = ` @${head.slice(0, 7)}`;
  const line = reason
    .split("")
    .map((ch) =>
      ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? " " : ch,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const room = LABEL_MAX - tail.length;
  return `${line.length <= room ? line : `${line.slice(0, room - 1)}…`}${tail}`;
}

/** Records the send-back unless the newest one already carries this label and category, so a rerun records nothing. */
async function recordSendBack(
  context: CommandContext,
  ledger: Awaited<ReturnType<typeof openJudgeLedger>>,
  pr: number,
  label: string,
  category: SendBackCategory,
): Promise<void> {
  const logged = await ledger.list({ kind: "send-back" });
  const newest = logged.events.filter((e) => e.number === pr).at(-1);
  if (newest?.label === label && newest?.category === category) {
    return;
  }
  const event = await ledger.record({
    source: "github",
    kind: "send-back",
    occurredAt: context.deps.clock.now().toISOString(),
    number: pr,
    label,
    category,
  });
  if (!event.ok) {
    throw new JudgeError(
      `The reason is on PR #${pr}, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness judge send-back ${pr}\`; the comment is not posted twice.`,
    );
  }
}

/** Posts the reason on the PR, where the orchestrator reads its queue, then records it. */
async function runSendBack(context: CommandContext): Promise<number> {
  const { deps } = context;
  try {
    const pr = prNumber(context.operand, SEND_BACK_USAGE);
    const reason = String(context.options["reason"] ?? "").trim();
    if (reason === "") {
      throw new JudgeError(`A send-back needs a reason. ${SEND_BACK_USAGE}`);
    }
    const category = categoryOf(context.options["category"]);
    const root = await deps.root();
    const repo = await repoOf(context);
    const ledger = await openJudgeLedger(context);
    const view = await readPr(context, root, repo, pr);
    if (!hasSentBack(view, reason)) {
      const signed = signedBody(
        deps.env,
        "judge send-back",
        sendBackBody(reason, view.headSha),
      );
      if ("error" in signed) {
        throw new JudgeError(signed.error);
      }
      const done = await deps.runner.run(
        "gh",
        ["pr", "comment", String(pr), "--repo", repo, "--body", signed.body],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw new JudgeError(
          `gh pr comment failed for PR #${pr}: ${done.stderr.trim()}. Check \`gh auth status\` and the PR number, then rerun \`harness judge send-back ${pr}\`.`,
        );
      }
    }
    await recordSendBack(
      context,
      ledger,
      pr,
      labelFor(reason, view.headSha),
      category,
    );
    deps.stdout(`PR #${pr}: sent back with the reason on the queue\n`);
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

export const mergeCommands: Record<string, Command> = {
  merge: {
    summary:
      'mutates; re-runs the precheck and squash-merges the verified head commit only when it passes; with no declared pattern, a mismatching diff or a failing enforce gate it merges nothing; a PR that GitHub refuses because it is behind main is refused naming the PR, "behind main" and the next step; each gate reads its mode from .claude/guardrails.yaml (rule judge-<item>, kind checklist): a failing audit gate is listed (audited in --json), writes one guard.audit ledger event per item and head, and never blocks the merge; an unreadable inventory or a mode other than audit or enforce is refused (<pr> [--json] [--reviewer <login>[,<login>]])',
    operand: "pr",
    options: { reviewer: "string" },
    run: runMerge,
  },
  "send-back": {
    summary:
      "posts the reason as a comment on the PR, the orchestrator's queue, and records a send-back event at the shared ledger with its category (<pr> --reason <why> --category <category>; one of: " +
      SEND_BACK_CATEGORIES.join(", ") +
      ")",
    operand: "pr",
    options: { reason: "string", category: "string" },
    run: runSendBack,
  },
};
