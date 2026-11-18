// The writing lines of the flow report's token cost section (#1093, spec #1086): the share of writer
// tokens attributed to an idea, the two unattributed buckets named beside the per-idea figures, and
// the pull requests that cannot be joined. A share below the minimum reads not read, and a bucket
// with a model the price table does not price names it; the lines name no winner and no verdict.

import type { FlowReport } from "../flow/index.js";

type Writing = FlowReport["costWaiting"]["writing"];
type Bucket = Writing["noIdea"];

const money = (value: number) => `$${value}`;

/** The share line: the percent of writer tokens attributed to an idea, or not read below the minimum. */
function shareLine(share: Writing["share"]): string {
  if (share.status === "insufficient") {
    return `Writing attributed to an idea: not read, ${share.sessions} session(s), ${share.needed} needed`;
  }
  return `Writing attributed to an idea: ${Math.round(share.share * 10_000) / 100}% of writer tokens over ${share.sessions} session(s)`;
}

/** A bucket line: its sessions, raw tokens, and dollars or the models it could not price. */
function bucketLine(name: string, bucket: Bucket): string {
  const dollars =
    bucket.dollars === null
      ? `insufficient prices (${(bucket.unpricedModels ?? []).join(", ")})`
      : money(bucket.dollars);
  return `Writing in ${name} (unattributed writer tokens): ${bucket.sessions} session(s), ${bucket.tokens} tokens, ${dollars}`;
}

/** The writing lines: the share, the no-idea and no-pull-request buckets, and the unjoinable pull requests. */
export function writingLines(writing: Writing): string[] {
  return [
    shareLine(writing.share),
    bucketLine("no idea", writing.noIdea),
    bucketLine("no pull request", writing.noPullRequest),
    `Pull requests opened with no link to a writer (unjoinable): ${writing.unjoinable}`,
  ];
}
