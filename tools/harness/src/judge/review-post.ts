import type { PrView } from "./checks.js";
import {
  reviewBody,
  VERDICT_HEAD_LENGTH,
  verdictText,
} from "./review-verdict.js";

export interface ReviewRequest {
  pr: number;
  findings: readonly string[];
  dryRun: boolean;
}

export interface ReviewPosted {
  pr: number;
  /** The head commit the verdict names, at the verdict's length. */
  head: string;
  verdict: string;
  count: number;
  /** The exact comment body, whether or not it was posted. */
  body: string;
  /** Whether a comment was written by this run. */
  posted: boolean;
  /** The posted comment's URL; undefined when nothing was posted. */
  url?: string;
}

/**
 * Formats the verdict for the PR's head and posts it, unless the identical body is already
 * on that head or this is a dry run. `comment` is the only write; it returns the URL.
 */
export async function postReview(
  request: ReviewRequest,
  view: PrView,
  comment: (body: string) => Promise<string>,
): Promise<ReviewPosted> {
  const body = reviewBody(view.headSha, request.findings);
  const summary = {
    pr: request.pr,
    head: view.headSha.slice(0, VERDICT_HEAD_LENGTH),
    verdict: verdictText(request.findings.length),
    count: request.findings.length,
    body,
  };
  const already = view.comments.some((c) => c.body.trim() === body);
  if (request.dryRun || already) {
    return { ...summary, posted: false };
  }
  return { ...summary, posted: true, url: await comment(body) };
}
