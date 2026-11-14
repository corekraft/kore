import { JudgeError, readPr, type PrView } from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { repoOf } from "./judge-shared.js";

/** The GitHub calls `harness review post` makes: one read of the PR, one comment. */
export interface ReviewIo {
  view(pr: number): Promise<PrView>;
  comment(pr: number, body: string): Promise<string>;
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
  };
}
