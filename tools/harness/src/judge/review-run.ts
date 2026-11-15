import type { PrView } from "./checks.js";
import { JudgeError } from "./errors.js";
import { postReview } from "./review-post.js";
import { VERDICT_HEAD_LENGTH } from "./review-verdict.js";
import { readVerdict } from "./review-verdict-read.js";

/** Reviews one head may take before the run gives up: the head moving on every one is a writer still pushing. */
export const MAX_REVIEW_RUNS = 3;

/** Every side effect `review run` has: GitHub through `review post`'s own calls, the pane through `session` tools, the ledger. */
export interface ReviewPorts {
  /** The PR as GitHub has it now. */
  view(pr: number): Promise<PrView>;
  /** `gh pr comment`: the URL of the comment written. */
  comment(pr: number, body: string): Promise<string>;
  /** `session spawn --role principles-review --no-wait`. */
  spawn(name: string, brief: string): Promise<void>;
  /** `session wait`: the Reviewer's outcome and the pane its text is in. */
  wait(name: string): Promise<{ outcome: "done" | "blocked"; paneId: string }>;
  /** The unwrapped text of the pane. */
  read(paneId: string): Promise<string>;
  /** `session close`. */
  close(name: string): Promise<void>;
  /** Appends a review.run event for the PR; a failed event is an error. */
  record(pr: number, label: string): Promise<void>;
}

export interface ReviewRunResult {
  pr: number;
  /** The head the verdict names, at the verdict's length. */
  head: string;
  /** Whether this run wrote a comment; false when the identical verdict was already on the head. */
  posted: boolean;
  /** Reviews it took, more than one when the head moved. */
  runs: number;
}

const short = (head: string): string => head.slice(0, VERDICT_HEAD_LENGTH);

/**
 * The Reviewer's brief. One line, so no line of it is only a verdict marker, which the
 * reader would take for the Reviewer's own answer.
 */
function briefFor(pr: number, head: string): string {
  return (
    `Review PR #${pr} at head ${short(head)} against AGENTS.md as your definition says, ` +
    `reading the change with \`gh pr diff ${pr}\` and the files at that head. ` +
    "Do not post anything and do not run `review post`: a tool posts your verdict. " +
    "End your final report with the verdict on lines of their own: either a line that is only " +
    '"VERDICT: none" when you found no violations, or a line that is only "VERDICT: findings", ' +
    "then each finding on its own line as `file:line | rule | what is wrong | smallest fix`, " +
    'then a line that is only "END VERDICT". Then end with the word RESULT, a colon, then done or blocked.'
  );
}

/**
 * Reviews a pull request's head and posts the verdict itself. The head is read once before the
 * Reviewer starts; the verdict is posted only if the head is still that one, and a moved head
 * discards the verdict and reviews again. A pane that ends blocked or with no parsable verdict
 * records a failure and posts nothing.
 */
export class ReviewRun {
  constructor(
    private readonly ports: ReviewPorts,
    private readonly maxRuns: number = MAX_REVIEW_RUNS,
  ) {}

  async run(pr: number): Promise<ReviewRunResult> {
    for (let runs = 1; runs <= this.maxRuns; runs++) {
      const reviewed = (await this.ports.view(pr)).headSha;
      const findings = await this.review(pr, reviewed);
      const now = await this.ports.view(pr);
      if (now.headSha !== reviewed) {
        await this.ports.record(pr, `rerun:${short(reviewed)}`);
        continue;
      }
      const done = await postReview(
        { pr, findings, dryRun: false },
        now,
        (body) => this.ports.comment(pr, body),
      );
      await this.ports.record(
        pr,
        `${done.posted ? "posted" : "unchanged"}:${short(reviewed)}`,
      );
      return { pr, head: done.head, posted: done.posted, runs };
    }
    await this.ports.record(pr, "failed:head moved");
    throw new JudgeError(
      `PR #${pr}'s head moved during every review (${this.maxRuns} runs), so no verdict was posted. Wait until the writer has stopped pushing, then rerun \`harness review run ${pr}\`.`,
    );
  }

  /** One Reviewer pane on one head; its findings, or a recorded failure. The pane is always closed. */
  private async review(pr: number, head: string): Promise<string[]> {
    const name = `pr${pr}-reviewer`;
    await this.ports.spawn(name, briefFor(pr, head));
    let text: string;
    try {
      const waited = await this.ports.wait(name);
      if (waited.outcome === "blocked") {
        await this.ports.record(pr, "failed:blocked");
        throw new JudgeError(
          `The Reviewer for PR #${pr} ended blocked, so no verdict was posted. Read its pane ${waited.paneId}, fix what blocked it, then rerun \`harness review run ${pr}\`.`,
        );
      }
      text = await this.ports.read(waited.paneId);
    } finally {
      await this.ports.close(name);
    }
    const findings = readVerdict(text);
    if (findings === undefined) {
      await this.ports.record(pr, "failed:no verdict");
      throw new JudgeError(
        `The Reviewer for PR #${pr} ended with no VERDICT block, so nothing was posted. Rerun \`harness review run ${pr}\`; if it repeats, read the Reviewer's definition and brief.`,
      );
    }
    return findings;
  }
}
