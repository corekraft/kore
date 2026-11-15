import {
  JudgeError,
  hasSentBack,
  readPr,
  sendBackBody,
  summary,
  type ItemVerdict,
} from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
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
const SEND_BACK_USAGE = 'Run `harness judge send-back <pr> --reason "<why>"`.';
const LABEL_MAX = 100;

/** One line per audit gate that failed and so was logged, never a reason to hold the merge. */
function auditLines(audited: readonly ItemVerdict[]): string {
  return audited
    .map(
      (a) =>
        `audit: ${a.item} ${a.result}${a.detail === undefined || a.detail === "" ? "" : ` (${a.detail})`}; logged, did not block the merge\n`,
    )
    .join("");
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
        `PR #${pr} was not merged: the precheck did not pass. Fix what it reports, or send the change back with \`harness judge send-back ${pr} --reason <why>\`.\n`,
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

/** Posts the reason on the PR, where the orchestrator reads its queue, then records it. */
async function runSendBack(context: CommandContext): Promise<number> {
  const { deps } = context;
  try {
    const pr = prNumber(context.operand, SEND_BACK_USAGE);
    const reason = String(context.options["reason"] ?? "").trim();
    if (reason === "") {
      throw new JudgeError(`A send-back needs a reason. ${SEND_BACK_USAGE}`);
    }
    const root = await deps.root();
    const repo = await repoOf(context);
    const ledger = await openJudgeLedger(context);
    const view = await readPr(context, root, repo, pr);
    if (!hasSentBack(view, reason)) {
      const done = await deps.runner.run(
        "gh",
        [
          "pr",
          "comment",
          String(pr),
          "--repo",
          repo,
          "--body",
          sendBackBody(reason, view.headSha),
        ],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw new JudgeError(
          `gh pr comment failed for PR #${pr}: ${done.stderr.trim()}. Check \`gh auth status\` and the PR number, then rerun \`harness judge send-back ${pr}\`.`,
        );
      }
    }
    const label = labelFor(reason, view.headSha);
    const logged = await ledger.list({ kind: "send-back" });
    const newest = logged.events.filter((e) => e.number === pr).at(-1);
    if (newest?.label !== label) {
      const event = await ledger.record({
        source: "github",
        kind: "send-back",
        occurredAt: deps.clock.now().toISOString(),
        number: pr,
        label,
      });
      if (!event.ok) {
        throw new JudgeError(
          `The reason is on PR #${pr}, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness judge send-back ${pr}\`; the comment is not posted twice.`,
        );
      }
    }
    deps.stdout(`PR #${pr}: sent back with the reason on the queue\n`);
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

export const mergeCommands: Record<string, Command> = {
  merge: {
    summary:
      "mutates; re-runs the precheck and squash-merges the verified head commit only when it passes; with no declared pattern, a mismatching diff or a failing enforce gate it merges nothing; each gate reads its mode from .claude/guardrails.yaml (rule judge-<item>, kind checklist): a failing audit gate is listed (audited in --json), writes one guard.audit ledger event per item and head, and never blocks the merge; an unreadable inventory or a mode other than audit or enforce is refused (<pr> [--json] [--reviewer <login>[,<login>]])",
    operand: "pr",
    options: { reviewer: "string" },
    run: runMerge,
  },
  "send-back": {
    summary:
      "posts the reason as a comment on the PR, the orchestrator's queue, and records a send-back event at the shared ledger (<pr> --reason <why>)",
    operand: "pr",
    options: { reason: "string" },
    run: runSendBack,
  },
};
