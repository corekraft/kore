import type { Runner } from "../runtime/index.js";

export const RESULTS = [
  "pass",
  "fail",
  "pending",
  "missing",
  "unverified",
] as const;
export type CheckResult = (typeof RESULTS)[number];

export interface Check {
  result: CheckResult;
  detail?: string;
}

export interface Checks {
  ci: Check;
  scan: Check;
  coverage: Check;
  principlesReview: Check;
}

export interface PrComment {
  body: string;
  author: string;
  createdAt: string;
}

export interface PrView {
  body: string;
  comments: PrComment[];
  /** When the newest commit on the PR was made; undefined when the PR lists none. */
  headCommittedAt: string | undefined;
  /** The commit the PR's branch points at now. */
  headSha: string;
  rollup: { name: string; status: string; conclusion: string; url: string }[];
}

/** The workflow job that holds CI, and the one that holds the scans. */
const CI_JOB = "check";
const SCAN_JOB = "scan";
/** The CI steps that run the suites with the coverage threshold: kore's and the harness's. */
const COVERAGE_STEPS = ["Unit tests", "Harness tests"];
const REVIEW = /^\s*principles-review:\s*(.*)$/im;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parsePrView(stdout: string): PrView | undefined {
  try {
    const view = JSON.parse(stdout) as Record<string, unknown>;
    const list = (key: string): Record<string, unknown>[] =>
      Array.isArray(view[key]) ? (view[key] as Record<string, unknown>[]) : [];
    return {
      body: text(view["body"]),
      comments: list("comments").map((c) => ({
        body: text(c["body"]),
        author: text(
          (c["author"] as Record<string, unknown> | null)?.["login"],
        ),
        createdAt: text(c["createdAt"]),
      })),
      headSha: text(view["headRefOid"]),
      headCommittedAt: list("commits")
        .map((c) => text(c["committedDate"]))
        .filter((d) => d !== "")
        .sort()
        .at(-1),
      rollup: list("statusCheckRollup").map((c) => ({
        name: text(c["name"]),
        status: text(c["status"]),
        conclusion: text(c["conclusion"]),
        url: text(c["detailsUrl"]),
      })),
    };
  } catch {
    return undefined;
  }
}

function fromConclusion(status: string, conclusion: string): CheckResult {
  if (status.toUpperCase() !== "COMPLETED") {
    return "pending";
  }
  return conclusion.toUpperCase() === "SUCCESS" ? "pass" : "fail";
}

function job(view: PrView, name: string): Check {
  const found = view.rollup.find((c) => c.name === name);
  if (found === undefined) {
    return { result: "missing", detail: `no "${name}" check on the PR` };
  }
  const result = fromConclusion(found.status, found.conclusion);
  return result === "pass"
    ? { result }
    : { result, detail: `${name}: ${found.conclusion || found.status}` };
}

const NAMED_HEAD = /\bhead\s+([0-9a-f]{7,40})\b/i;

/**
 * Whether a review covers the PR's current head. A review that names a commit
 * (`head <sha>`) is current only if that is the head; otherwise it must be newer
 * than the head commit.
 */
function current(view: PrView, comment: PrComment): boolean {
  const named = NAMED_HEAD.exec(comment.body)?.[1]?.toLowerCase();
  if (named !== undefined) {
    return view.headSha.toLowerCase().startsWith(named);
  }
  return (
    view.headCommittedAt !== undefined &&
    Date.parse(comment.createdAt) > Date.parse(view.headCommittedAt)
  );
}

/**
 * The newest `principles-review:` comment from a known reviewer, made after the head
 * commit, decides. A review from anyone else, or from before the head commit, is not
 * trusted: the result is unverified, not a pass.
 */
function review(view: PrView, reviewers: readonly string[]): Check {
  const reviews = view.comments.filter((c) => REVIEW.test(c.body));
  if (reviews.length === 0) {
    return {
      result: "missing",
      detail:
        "no `principles-review:` comment; run the principles-review agent and post its verdict as `principles-review: No violations.` or `principles-review: <n> violations`",
    };
  }
  if (reviewers.length === 0) {
    return {
      result: "unverified",
      detail:
        "no known reviewer identity; rerun with `--reviewer <login>` naming who posts principles-review verdicts",
    };
  }
  const trusted = reviews
    .filter((c) => reviewers.includes(c.author) && current(view, c))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1);
  if (trusted === undefined) {
    return {
      result: "unverified",
      detail: `no principles-review comment from ${reviewers.join(" or ")} for the current head (name it as "head <sha>", or post it after the head commit); rerun the review on the current head`,
    };
  }
  const verdict = (REVIEW.exec(trusted.body)?.[1] ?? "")
    .replace(/\s*\(?\bhead\s+[0-9a-f]{7,40}\)?\s*$/i, "")
    .trim();
  return /^no violations\.?$/i.test(verdict)
    ? { result: "pass" }
    : { result: "fail", detail: verdict };
}

async function coverage(
  runner: Runner,
  root: string,
  repo: string,
  pr: PrView,
): Promise<Check> {
  const url = pr.rollup.find((c) => c.name === CI_JOB)?.url ?? "";
  const run = /\/actions\/runs\/(\d+)/.exec(url)?.[1];
  if (run === undefined) {
    return {
      result: "missing",
      detail: "no CI run on the PR to read coverage out of",
    };
  }
  const done = await runner.run(
    "gh",
    ["run", "view", run, "--repo", repo, "--json", "jobs"],
    {
      cwd: root,
    },
  );
  if (done.code !== 0) {
    return { result: "missing", detail: `gh run view ${run} failed` };
  }
  try {
    const parsed = JSON.parse(done.stdout) as { jobs?: unknown };
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const steps = jobs.flatMap((j: { name?: string; steps?: unknown }) =>
      j.name === CI_JOB && Array.isArray(j.steps)
        ? (j.steps as { name?: string; conclusion?: string }[])
        : [],
    );
    const found = COVERAGE_STEPS.map((name) => ({
      name,
      step: steps.find((s) => s.name === name),
    }));
    const absent = found.find((f) => f.step === undefined);
    if (absent !== undefined) {
      return {
        result: "missing",
        detail: `no "${absent.name}" step in run ${run}`,
      };
    }
    const bad = found.find((f) => f.step?.conclusion !== "success");
    if (bad === undefined) {
      return { result: "pass" };
    }
    const concluded = bad.step?.conclusion ?? "";
    return {
      result: concluded === "" ? "pending" : "fail",
      detail: `${bad.name}: ${concluded === "" ? "not finished" : concluded}`,
    };
  } catch {
    return {
      result: "missing",
      detail: `gh run view ${run} returned unreadable output`,
    };
  }
}

/** CI, scan, coverage and principles-review results, gathered through read-only gh calls. */
export async function gatherChecks(
  runner: Runner,
  root: string,
  repo: string,
  view: PrView,
  reviewers: readonly string[],
): Promise<Checks> {
  return {
    ci: job(view, CI_JOB),
    scan: job(view, SCAN_JOB),
    coverage: await coverage(runner, root, repo, view),
    principlesReview: review(view, reviewers),
  };
}
