import type { PrView } from "./checks.js";
import { formatSender, withoutSender, type Sender } from "../sender/index.js";
import {
  reviewBody,
  VERDICT_HEAD_LENGTH,
  verdictText,
} from "./review-verdict.js";

export interface ReviewRequest {
  pr: number;
  findings: readonly string[];
  dryRun: boolean;
  /** Who posts the verdict; its line is the first line of the comment. */
  sender: Sender;
}

export interface ReviewPosted {
  pr: number;
  /** The head commit the verdict names, at the verdict's length. */
  head: string;
  verdict: string;
  count: number;
  /** The exact comment body, sender line first, whether or not it was posted. */
  body: string;
  /** Whether a comment was written by this run. */
  posted: boolean;
  /** The posted comment's URL; undefined when nothing was posted. */
  url?: string;
}

/**
 * Formats the verdict for the PR's head, with the sender line first, and posts it, unless the
 * identical verdict is already on that head or this is a dry run. A comment written before
 * sender lines existed is read without its line, so it still counts. `comment` is the only
 * write; it returns the URL.
 */
export async function postReview(
  request: ReviewRequest,
  view: PrView,
  comment: (body: string) => Promise<string>,
): Promise<ReviewPosted> {
  const verdict = reviewBody(view.headSha, request.findings);
  const body = `${formatSender(request.sender)}\n${verdict}`;
  const summary = {
    pr: request.pr,
    head: view.headSha.slice(0, VERDICT_HEAD_LENGTH),
    verdict: verdictText(request.findings.length),
    count: request.findings.length,
    body,
  };
  const already = view.comments.some(
    (c) => withoutSender(c.body).trim() === verdict,
  );
  if (request.dryRun || already) {
    return { ...summary, posted: false };
  }
  return { ...summary, posted: true, url: await comment(body) };
}
