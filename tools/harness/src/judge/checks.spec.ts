import { describe, expect, it } from "vitest";
import {
  gatherChecks,
  parsePrView,
  type PrComment,
  type PrView,
} from "./checks.js";
import {
  asRunner,
  REPO,
  ROOT,
  RUN_URL,
  runnerOf,
  SHA,
  stepsJson,
  viewOf,
} from "./checks-support.js";

/** Gathers the checks for a view whose CI rollup names no run, so coverage is not read. */
async function gather(view: PrView, reviewers: string[] = ["bot"]) {
  const checks = await gatherChecks(
    asRunner(runnerOf()),
    ROOT,
    REPO,
    viewOf({ ...view, rollup: view.rollup.map((c) => ({ ...c, url: "" })) }),
    reviewers,
  );
  return { checks };
}

const review = (
  body: string,
  author = "bot",
  createdAt = "2026-01-02T00:00:00Z",
): PrComment => ({ body, author, createdAt });

describe("PR view parsing", () => {
  it("reads the fields the judge needs, with the newest commit date as the head's", () => {
    const view = parsePrView(
      JSON.stringify({
        baseRefOid: "base",
        body: "Safety pattern: no-behaviour-change",
        comments: [
          {
            body: "principles-review: No violations.",
            author: { login: "bot" },
            createdAt: "2026-01-02T00:00:00Z",
          },
        ],
        commits: [
          { committedDate: "2026-01-01T00:00:00Z" },
          { committedDate: "2026-01-03T00:00:00Z" },
        ],
        headRefOid: SHA,
        statusCheckRollup: [
          {
            name: "check",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: RUN_URL,
          },
        ],
      }),
    );
    expect(view).toEqual({
      baseSha: "base",
      body: "Safety pattern: no-behaviour-change",
      comments: [review("principles-review: No violations.")],
      headCommittedAt: "2026-01-03T00:00:00Z",
      headSha: SHA,
      rollup: [
        {
          name: "check",
          status: "COMPLETED",
          conclusion: "SUCCESS",
          url: RUN_URL,
        },
      ],
    });
  });

  it("reads missing fields as empty, and a PR with no commits has no head date", () => {
    expect(parsePrView("{}")).toEqual({
      baseSha: "",
      body: "",
      comments: [],
      headCommittedAt: undefined,
      headSha: "",
      rollup: [],
    });
  });

  it.each([["not json"], ["null"]])(
    "reports unreadable output %j as no view, not as a crash",
    (stdout) => {
      expect(parsePrView(stdout)).toBeUndefined();
    },
  );
});

describe("CI and scan results", () => {
  it("passes a completed successful job and fails a completed unsuccessful one, naming the conclusion", async () => {
    const { checks } = await gather(
      viewOf({
        rollup: [
          {
            name: "check",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            url: "",
          },
          { name: "scan", status: "COMPLETED", conclusion: "FAILURE", url: "" },
        ],
      }),
    );
    expect(checks.ci).toEqual({ result: "pass" });
    expect(checks.scan).toEqual({ result: "fail", detail: "scan: FAILURE" });
  });

  it("reports a job still running as pending, and a job that is not on the PR as missing", async () => {
    const { checks } = await gather(
      viewOf({
        rollup: [
          { name: "check", status: "IN_PROGRESS", conclusion: "", url: "" },
        ],
      }),
    );
    expect(checks.ci).toEqual({
      result: "pending",
      detail: "check: IN_PROGRESS",
    });
    expect(checks.scan).toEqual({
      result: "missing",
      detail: 'no "scan" check on the PR',
    });
  });
});

describe("principles-review trust", () => {
  it("is missing until a principles-review comment is posted", async () => {
    const { checks } = await gather(viewOf({ comments: [] }));
    expect(checks.principlesReview.result).toBe("missing");
    expect(checks.principlesReview.detail).toContain(
      "no `principles-review:` comment",
    );
  });

  it("is unverified when no reviewer is named, however clean the review reads", async () => {
    const { checks } = await gather(
      viewOf({ comments: [review("principles-review: No violations.")] }),
      [],
    );
    expect(checks.principlesReview.result).toBe("unverified");
  });

  it("passes a clean review by a named reviewer made after the head commit", async () => {
    const { checks } = await gather(
      viewOf({ comments: [review("principles-review: No violations.")] }),
    );
    expect(checks.principlesReview).toEqual({ result: "pass" });
  });

  it("fails a review that names violations, and strips the head suffix from its detail", async () => {
    const { checks } = await gather(
      viewOf({
        comments: [
          review(`principles-review: 2 violations (head ${SHA.slice(0, 7)})`),
        ],
      }),
    );
    expect(checks.principlesReview).toEqual({
      result: "fail",
      detail: "2 violations",
    });
  });

  it("takes the newest trusted review when several name the current head", async () => {
    const { checks } = await gather(
      viewOf({
        comments: [
          review(
            "principles-review: 2 violations",
            "bot",
            "2026-01-03T00:00:00Z",
          ),
          review(
            "principles-review: No violations.",
            "bot",
            "2026-01-02T00:00:00Z",
          ),
        ],
      }),
    );
    expect(checks.principlesReview).toEqual({
      result: "fail",
      detail: "2 violations",
    });
  });
});

describe("principles-review: who and when", () => {
  it("does not trust a review from an unnamed author or from before the head commit", async () => {
    const stranger = await gather(
      viewOf({
        comments: [review("principles-review: No violations.", "eve")],
      }),
    );
    expect(stranger.checks.principlesReview.result).toBe("unverified");
    const stale = await gather(
      viewOf({
        comments: [
          review(
            "principles-review: No violations.",
            "bot",
            "2025-12-31T00:00:00Z",
          ),
        ],
      }),
    );
    expect(stale.checks.principlesReview.result).toBe("unverified");
  });
});

describe("principles-review named heads", () => {
  it("trusts a review that names the current head even when it predates the head commit", async () => {
    const { checks } = await gather(
      viewOf({
        comments: [
          review(
            `principles-review: No violations. head ${SHA.slice(0, 7)}`,
            "bot",
            "2025-12-31T00:00:00Z",
          ),
        ],
      }),
    );
    expect(checks.principlesReview).toEqual({ result: "pass" });
  });
});

async function coverageOf(stdout: string, code = 0, url = RUN_URL) {
  const runner = runnerOf(stdout, code);
  const checks = await gatherChecks(
    asRunner(runner),
    ROOT,
    REPO,
    viewOf({
      rollup: [
        { name: "check", status: "COMPLETED", conclusion: "SUCCESS", url },
      ],
    }),
    ["bot"],
  );
  return { coverage: checks.coverage, runner };
}

describe("coverage read from the CI run", () => {
  it("passes when both suites that enforce coverage succeeded, reading the run the CI check names", async () => {
    const { coverage, runner } = await coverageOf(
      stepsJson({ "Unit tests": "success", "Harness tests": "success" }),
    );
    expect(coverage).toEqual({ result: "pass" });
    expect(runner.run.mock.calls).toEqual([
      [
        "gh",
        ["run", "view", "777", "--repo", REPO, "--json", "jobs"],
        { cwd: ROOT },
      ],
    ]);
  });

  it("is missing when the CI check names no run, and does not ask gh", async () => {
    const { coverage, runner } = await coverageOf("", 0, "");
    expect(coverage).toEqual({
      result: "missing",
      detail: "no CI run on the PR to read coverage out of",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("coverage read failures", () => {
  it("is missing when gh cannot read the run, and when its output is not JSON", async () => {
    expect((await coverageOf("", 1)).coverage).toEqual({
      result: "missing",
      detail: "gh run view 777 failed",
    });
    expect((await coverageOf("not json")).coverage).toEqual({
      result: "missing",
      detail: "gh run view 777 returned unreadable output",
    });
  });

  it("is missing when a suite that enforces coverage has no step in the run", async () => {
    const { coverage } = await coverageOf(
      stepsJson({ "Unit tests": "success" }),
    );
    expect(coverage).toEqual({
      result: "missing",
      detail: 'no "Harness tests" step in run 777',
    });
  });

  it("fails a suite that concluded unsuccessfully, and is pending while a suite has not finished", async () => {
    const failed = await coverageOf(
      stepsJson({ "Unit tests": "failure", "Harness tests": "success" }),
    );
    expect(failed.coverage).toEqual({
      result: "fail",
      detail: "Unit tests: failure",
    });
    const running = await coverageOf(
      stepsJson({ "Unit tests": "success", "Harness tests": "" }),
    );
    expect(running.coverage).toEqual({
      result: "pending",
      detail: "Harness tests: not finished",
    });
  });
});
