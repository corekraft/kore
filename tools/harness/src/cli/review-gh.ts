import { JudgeError, readPr, type PrView } from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { openJudgeLedger, repoOf } from "./judge-shared.js";

/**
 * What `harness review post` does: one read of the PR, one comment, and the ledger event for
 * the verdict it posted: the PR, the head, the count and the cited rule labels, never the text.
 */
export interface ReviewIo {
  view(pr: number): Promise<PrView>;
  comment(pr: number, body: string): Promise<string>;
  record(
    pr: number,
    head: string,
    count: number,
    rules: readonly string[],
  ): Promise<void>;
}

/**
 * The real port: the PR is read and commented through gh on the repository this bundle was
 * built in, never GH_REPO or the working directory. The comment's URL is what gh prints.
 */
export async function ghReviewIo(context: CommandContext): Promise<ReviewIo> {
  const root = await context.deps.root();
  const repo = await repoOf(context);
  return {
    view: (pr) => readPr(context, root, repo, pr),
    comment: async (pr, body) => {
      const done = await context.deps.runner.run(
        "gh",
        ["pr", "comment", String(pr), "--repo", repo, "--body", body],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw new JudgeError(
          `gh pr comment failed for PR #${pr}: ${done.stderr.trim()}. Check \`gh auth status\` and the PR number, then rerun \`harness review post ${pr}\`.`,
        );
      }
      return done.stdout.trim();
    },
    record: async (pr, head, count, rules) => {
      const ledger = await openJudgeLedger(context);
      const event = await ledger.record({
        source: "claude",
        kind: "review.run",
        occurredAt: context.deps.clock.now().toISOString(),
        number: pr,
        label: `posted:${head}`,
        stage: "review",
        findings: count,
        ...(rules.length === 0 ? {} : { rules: rules.join(",") }),
      });
      if (!event.ok) {
        throw new JudgeError(
          `The verdict on PR #${pr} is posted, but its review.run event was rejected: ${event.message} Fix the ledger and record the event by hand with \`harness ledger record\`; rerunning \`review post\` posts nothing and records nothing.`,
        );
      }
    },
  };
}
