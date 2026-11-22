import {
  findingsFrom,
  JudgeError,
  postReview,
  ruleLabels,
  type ReviewPosted,
} from "../judge/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import { senderFrom } from "../sender/index.js";
import { failed, prNumber } from "./judge-shared.js";
import { ghReviewIo, type ReviewIo } from "./review-gh.js";
import { reviewResampleRun } from "./review-resample-command.js";
import { sessionResampleIo } from "./review-resample-io.js";
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
    const sender = senderFrom(deps.env, "review post");
    if ("error" in sender) {
      throw new JudgeError(sender.error);
    }
    const io = await load();
    const done = await postReview(
      { pr, findings, dryRun, sender },
      await io.view(pr),
      (body) => io.comment(pr, body),
    );
    if (done.posted) {
      await io.record(done.pr, done.head, done.count, ruleLabels(findings));
    }
    deps.stdout(json ? `${JSON.stringify(done)}\n` : summaryOf(done, dryRun));
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

const postHelp: CommandHelp = {
  purpose:
    "Posts a principles-review verdict on a PR's head as a comment, in the format the judge's precheck reads: the findings, one per line on stdin, or --none for a clean review. It posts nothing when the identical verdict is already on that head.",
  when: "After a principles-review Reviewer reports on a PR and the caller holds its findings, so a tool formats and posts the verdict.",
  whenNot:
    "When no Reviewer has run yet, use review run, which runs the Reviewer and posts its verdict itself. Do not write a verdict comment with gh by hand.",
  flags: {
    none: "Post the clean review, with no violations. Refused when findings also come on stdin, and when stdin is empty without this flag.",
    "dry-run":
      "Print the exact comment that would be posted, sender line first, and post nothing.",
  },
  operand: "The pull request number, a positive whole number.",
  examples: [
    {
      command: "harness review post 942 --none",
      shows:
        "PR 942 gets the clean verdict for its head, or nothing is posted when that verdict is already there",
    },
    {
      command: "harness review post 942 --dry-run --none",
      shows:
        "the exact comment the clean verdict would post, with nothing posted",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the verdict is posted, already on the head, or printed by --dry-run",
    },
    {
      code: 1,
      meaning:
        "refused: no findings and no --none, findings given with --none, a sender the environment cannot name, or gh could not post; stderr names the fix",
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
      "posts one comment on the PR's head unless the identical verdict is already on it or --dry-run is set; a comment it posts is recorded as a review.run event at the shared ledger, with the PR, the head, the finding count and the rule labels, never the verdict text",
  },
  seeAlso: ["review run", "review resample", "judge precheck"],
};

const runHelp: CommandHelp = {
  purpose:
    "Reviews a PR's head with a principles-review Reviewer pane and posts the verdict for that head itself. It spawns the Reviewer through session spawn, collects its verdict with session wait, and posts it with the code review post uses; a head that moves during a review is reviewed again, up to three reviews.",
  when: "When a PR has no principles-review verdict on its head yet, so the judge's precheck can read one. The orchestrator runs it; the judge pane may not, since its role list has no review command.",
  whenNot:
    "When a Reviewer has already reported and you hold its findings, use review post, which posts them without spawning a pane. When passed reviews of merged PRs need a second look, use review resample.",
  flags: {},
  operand: "The pull request number, a positive whole number.",
  examples: [
    {
      command: "harness review run 942",
      shows:
        "the verdict posted for PR 942's head, with how many reviews it took when the head moved",
    },
    {
      command: "harness review run 942 --json",
      shows: "the result as one JSON object: pr, head, posted and runs",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the verdict is posted for the head, or the identical one was already there",
    },
    {
      code: 1,
      meaning:
        "refused: the Reviewer ended blocked or without a VERDICT block, the head moved in all three reviews, or a session or gh call failed; stderr names the fix",
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
      "spawns one principles-review pane per review, named pr<N>-reviewer, and closes it once its verdict is read; posts one comment on the PR unless the identical verdict is already there; appends a review.run event per review to the shared ledger, labelled posted or unchanged with the head, rerun when the head moved, or failed when the Reviewer was blocked, gave no verdict, or the head moved every time",
  },
  seeAlso: [
    "review post",
    "review resample",
    "judge precheck",
    "session spawn",
  ],
};

const resampleHelp: CommandHelp = {
  purpose:
    "Re-reviews a sample of passed reviews of merged PRs, to check that the principles review passed them rightly. It draws up to --size heads that no re-review has taken yet and runs one Sonnet reader per head through session spawn. Each reader's result is recorded as a review.run event; nothing is posted to GitHub.",
  when: "For a periodic check of review quality, once several PRs have merged, so the flow report's re-review ratio has fresh data.",
  whenNot:
    "When a PR itself needs a review, use review run, which posts a verdict. When no passed review is waiting, this starts no reader and says so.",
  flags: {
    size: "How many heads to re-review: a whole number of 1 or more; without it, 5.",
  },
  examples: [
    {
      command: "harness review resample --size 3",
      shows:
        "one line per sampled head with its findings, or the reason its reader failed, and the totals",
    },
    {
      command: "harness review resample",
      shows:
        "a sample of 5 re-reviews, or that no passed review of a merged PR is waiting",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the sample was re-reviewed, or none was waiting; a reader that failed is listed and recorded, not an exit code",
    },
    {
      code: 1,
      meaning:
        "refused: --size is not a whole number of 1 or more, or the ledger or a session call failed; stderr names the fix",
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
      "starts one Sonnet reader pane per sampled head, named resample-pr<N>-<head>, on the high effort, and closes it once its verdict is read; appends a review.run event per head to the shared ledger, labelled resample:<head> with its finding count, or resample-failed:<head> when the reader was blocked or gave no verdict; posts nothing to GitHub",
  },
  seeAlso: ["review run", "review post", "flow report"],
};

export const reviewCommands: Record<string, Command> = {
  post: {
    summary:
      "mutates; formats the principles-review verdict for the PR's head in the format the precheck reads and posts it as a comment, unless the identical verdict is already on that head, and records a review.run event for a verdict it posted, with the PR, the head, the violation count and the cited rule labels and no verdict text, so a repost writes no second event (<pr> [--none] [--dry-run] [--json]; findings one per line on stdin)",
    operand: "pr",
    help: postHelp,
    options: { none: "boolean", "dry-run": "boolean" },
    run: (context) => reviewPostRun(context, () => ghReviewIo(context)),
  },
  run: {
    summary:
      "mutates; reads the PR's head once, spawns the principles-review Reviewer through `session spawn` at its declared tier, collects its verdict with `session wait`, and posts it through `review post`'s code for that same head, so a tool, not a model, posts the verdict; a head that moved during the review discards the verdict and reviews again (up to 3 reviews, then fails); a pane that ends blocked or with no parsable verdict records a review.run failure event and posts nothing (<pr> [--json])",
    operand: "pr",
    help: runHelp,
    run: reviewRunRun,
  },
  resample: {
    summary:
      "mutates; draws a sample of the passed reviews of merged PRs that no re-review has taken yet, and re-reviews each sampled head with a Sonnet reader on the override tier, which `session spawn` records with its reason, collecting its verdict with `session wait`; records each re-review as a review.run labelled resample:<head> with its findings, or resample-failed:<head> when the reader ends blocked or with no verdict, and posts nothing to GitHub, so the re-reviews are counted in the flow report beside the ratio (--size n, default 5, a placeholder; [--json])",
    help: resampleHelp,
    options: { size: "string" },
    run: (context) =>
      reviewResampleRun(context, () => sessionResampleIo(context), Math.random),
  },
};
