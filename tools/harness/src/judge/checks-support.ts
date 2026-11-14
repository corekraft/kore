// Data and builders for the checks specs: a PR view, comments, rollup entries and gh output.
import type { PrComment, PrView } from "./checks.js";

export const HEAD = "abc1234def5678abc1234def5678abc1234def56";
export const COMMITTED = "2026-11-14T10:00:00Z";
export const REVIEWERS = ["reviewer-bot"];
export const RUN_URL =
  "https://github.com/corekraft/kore/actions/runs/777/job/1";

export const view = (over: Partial<PrView> = {}): PrView => ({
  baseSha: "base0000",
  body: "",
  comments: [],
  headCommittedAt: COMMITTED,
  headSha: HEAD,
  rollup: [],
  ...over,
});

export const review = (
  body: string,
  author = "reviewer-bot",
  createdAt = "2026-11-14T11:00:00Z",
): PrComment => ({ body, author, createdAt });

export const rollupCheck = (
  name: string,
  status = "COMPLETED",
  conclusion = "SUCCESS",
  url = RUN_URL,
) => ({ name, status, conclusion, url });

/** The `gh run view --json jobs` output for one CI job with these steps. */
export const jobs = (steps: { name: string; conclusion: string }[]) =>
  JSON.stringify({ jobs: [{ name: "check", steps }] });

export const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
