import {
  type ExpandCheck,
  type ExpandComment,
  type ExpandFacts,
  expandStepCheck,
} from "./expand-step-check.js";
import type { Api } from "./manifest-source.js";
import { parseExpandPr } from "./parse-expand-pr.js";
import { parseIssueComments } from "./parse-issue-comments.js";

/** The Idea line's issue, with or without its `#`. */
const ISSUE = /^#?(\d+)$/;

/**
 * Reads the expand PR's merge time, and the idea issue's comments when the idea names one,
 * through gh; unreadable output is a missing check, not a verdict.
 */
export async function readExpandStep(
  api: Api,
  facts: Omit<ExpandFacts, "mergedAt" | "comments">,
): Promise<ExpandCheck> {
  const { pr, expandPr, idea, headCommittedAt, reviewers } = facts;
  const merged = parseExpandPr(
    await api(["pr", "view", String(expandPr), "--json", "mergedAt"]),
  );
  if (merged === undefined) {
    return {
      result: "missing",
      detail: `gh returned unreadable output for expand step #${expandPr}`,
    };
  }
  const issue = ISSUE.exec(idea ?? "")?.[1];
  let comments: ExpandComment[] = [];
  if (issue !== undefined) {
    const parsed = parseIssueComments(
      await api(["issue", "view", issue, "--json", "comments"]),
    );
    if (parsed === undefined) {
      return {
        result: "missing",
        detail: `gh returned unreadable comments for issue #${issue}`,
      };
    }
    comments = parsed;
  }
  return expandStepCheck({
    pr,
    expandPr,
    mergedAt: merged.mergedAt,
    headCommittedAt,
    idea,
    comments,
    reviewers,
  });
}
