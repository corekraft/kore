import { JudgeError, precheck, summary } from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import {
  FAILED,
  failed,
  openJudgeLedger,
  prNumber,
  record,
  reviewersOf,
} from "./judge-shared.js";

const MERGE_USAGE =
  "Run `harness judge merge <pr> [--json] [--reviewer <login>[,<login>]]`.";
const SEND_BACK_USAGE = 'Run `harness judge send-back <pr> --reason "<why>"`.';
const LABEL_MAX = 100;

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
    const report = await precheck(context, root, pr, reviewersOf(context));
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
    deps.stdout(
      json
        ? `${JSON.stringify({ pr, merged: true, head: report.head })}\n`
        : `PR #${pr}: squash-merged at ${report.head}\n`,
    );
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

/** The ledger label for a reason: one line, no control characters, at most 100 characters. */
function labelFor(reason: string): string {
  const line = reason
    .split("")
    .map((ch) =>
      ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? " " : ch,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return line.length <= LABEL_MAX ? line : `${line.slice(0, LABEL_MAX - 1)}…`;
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
    const ledger = await openJudgeLedger(context);
    const done = await deps.runner.run(
      "gh",
      [
        "pr",
        "comment",
        String(pr),
        "--body",
        `Sent back by the judge: ${reason}`,
      ],
      { cwd: root },
    );
    if (done.code !== 0) {
      throw new JudgeError(
        `gh pr comment failed for PR #${pr}: ${done.stderr.trim()}. Check \`gh auth status\` and the PR number, then rerun \`harness judge send-back ${pr}\`.`,
      );
    }
    const event = await ledger.record({
      source: "github",
      kind: "send-back",
      occurredAt: deps.clock.now().toISOString(),
      number: pr,
      label: labelFor(reason),
    });
    if (!event.ok) {
      throw new JudgeError(
        `The reason was posted on PR #${pr}, but its ledger event was rejected: ${event.message} Fix the ledger; do not post the reason twice.`,
      );
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
      "mutates; re-runs the precheck and squash-merges the verified head commit only when it passes; with no declared pattern, a mismatching diff or a failing check it merges nothing (<pr> [--json] [--reviewer <login>[,<login>]])",
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
