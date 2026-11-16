import { JudgeError, ReviewRun, type ReviewRunResult } from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { senderFrom } from "../sender/index.js";
import { failed, prNumber } from "./judge-shared.js";
import { sessionReviewPorts } from "./review-run-io.js";

const USAGE = "Run `harness review run <pr> [--json]`.";

function summaryOf(done: ReviewRunResult): string {
  const after = done.runs > 1 ? ` after ${done.runs} reviews` : "";
  return done.posted
    ? `PR #${done.pr}: principles-review verdict posted for head ${done.head}${after}\n`
    : `PR #${done.pr}: the verdict for head ${done.head} was already posted; nothing posted${after}\n`;
}

/**
 * Reviews the PR's head with a Reviewer pane and posts the verdict for that head. The ports
 * are built only after the PR number is accepted, so a refused number starts no pane.
 */
export async function reviewRunRun(context: CommandContext): Promise<number> {
  try {
    const pr = prNumber(context.operand, USAGE);
    const sender = senderFrom(context.deps.env, "review run");
    if ("error" in sender) {
      throw new JudgeError(sender.error);
    }
    const done = await new ReviewRun(await sessionReviewPorts(context)).run(
      pr,
      sender,
    );
    context.deps.stdout(
      context.json ? `${JSON.stringify(done)}\n` : summaryOf(done),
    );
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}
