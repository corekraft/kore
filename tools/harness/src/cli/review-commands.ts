import { findingsFrom, postReview, type ReviewPosted } from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { failed, prNumber } from "./judge-shared.js";
import { ghReviewIo, type ReviewIo } from "./review-gh.js";
import { reviewRunRun } from "./review-run-command.js";

const POST_USAGE =
  "Run `harness review post <pr> [--none] [--dry-run] [--json]`, with findings one per line on stdin.";

function summaryOf(done: ReviewPosted, dryRun: boolean): string {
  if (dryRun) {
    return `${done.body}\n`;
  }
  const verdict = `principles-review: ${done.verdict} (head ${done.head})`;
  return done.posted
    ? `PR #${done.pr}: posted ${verdict} at ${done.url ?? ""}\n`
    : `PR #${done.pr}: ${verdict} is already on this head; nothing posted\n`;
}

/**
 * Reads the findings, reads the PR's head, and posts the verdict on it unless the identical
 * one is already there. The GitHub port is loaded only after the input is accepted, so a
 * refused post never reaches gh.
 */
export async function reviewPostRun(
  context: CommandContext,
  load: () => Promise<ReviewIo>,
): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand, POST_USAGE);
    const none = context.options["none"] === true;
    const dryRun = context.options["dry-run"] === true;
    const findings = findingsFrom(await deps.stdin(), none);
    const io = await load();
    const done = await postReview(
      { pr, findings, dryRun },
      await io.view(pr),
      (body) => io.comment(pr, body),
    );
    deps.stdout(json ? `${JSON.stringify(done)}\n` : summaryOf(done, dryRun));
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

export const reviewCommands: Record<string, Command> = {
  post: {
    summary:
      "mutates; formats the principles-review verdict for the PR's head in the format the precheck reads and posts it as a comment, unless the identical verdict is already on that head (<pr> [--none] [--dry-run] [--json]; findings one per line on stdin)",
    operand: "pr",
    options: { none: "boolean", "dry-run": "boolean" },
    run: (context) => reviewPostRun(context, () => ghReviewIo(context)),
  },
  run: {
    summary:
      "mutates; reads the PR's head once, spawns the principles-review Reviewer through `session spawn` at its declared tier, collects its verdict with `session wait`, and posts it through `review post`'s code for that same head, so a tool, not a model, posts the verdict; a head that moved during the review discards the verdict and reviews again (up to 3 reviews, then fails); a pane that ends blocked or with no parsable verdict records a review.run failure event and posts nothing (<pr> [--json])",
    operand: "pr",
    run: reviewRunRun,
  },
};
