import type { Runner } from "../runtime/index.js";

export const RESULTS = ["pass", "fail", "pending", "missing"] as const;
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

export interface PrView {
  body: string;
  comments: string[];
  rollup: { name: string; status: string; conclusion: string; url: string }[];
}

/** The workflow job that holds CI, and the one that holds the scans. */
const CI_JOB = "check";
const SCAN_JOB = "scan";
/** The CI step that runs the harness tests with the coverage threshold. */
const COVERAGE_STEP = "Harness tests";
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
      comments: list("comments").map((c) => text(c["body"])),
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

/** The newest `principles-review:` comment decides; none at all is missing. */
function review(view: PrView): Check {
  const latest = [...view.comments]
    .reverse()
    .map((c) => REVIEW.exec(c)?.[1]?.trim())
    .find((m) => m !== undefined);
  if (latest === undefined) {
    return {
      result: "missing",
      detail:
        "no `principles-review:` comment; run the principles-review agent and post its verdict as `principles-review: No violations.` or `principles-review: <n> violations`",
    };
  }
  return /^no violations\.?$/i.test(latest)
    ? { result: "pass" }
    : { result: "fail", detail: latest };
}

async function coverage(
  runner: Runner,
  root: string,
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
  const done = await runner.run("gh", ["run", "view", run, "--json", "jobs"], {
    cwd: root,
  });
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
    const step = steps.find((s) => s.name === COVERAGE_STEP);
    if (step === undefined) {
      return {
        result: "missing",
        detail: `no "${COVERAGE_STEP}" step in run ${run}`,
      };
    }
    const result = fromConclusion(
      step.conclusion === undefined || step.conclusion === ""
        ? ""
        : "COMPLETED",
      step.conclusion ?? "",
    );
    return result === "pass"
      ? { result }
      : {
          result,
          detail: `${COVERAGE_STEP}: ${step.conclusion ?? "not finished"}`,
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
  view: PrView,
): Promise<Checks> {
  return {
    ci: job(view, CI_JOB),
    scan: job(view, SCAN_JOB),
    coverage: await coverage(runner, root, view),
    principlesReview: review(view),
  };
}
