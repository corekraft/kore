import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { testHarness } from "./cli-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

const URL = "https://github.com/corekraft/kore/actions/runs/9/job/1";
const job = (name: string) => ({
  name,
  status: "COMPLETED",
  conclusion: "SUCCESS",
  detailsUrl: URL,
});

function pr(overrides: Record<string, unknown>, runView?: FakeResponse) {
  const view = {
    body: "Safety pattern: expand-contract",
    statusCheckRollup: [job("check"), job("scan")],
    commits: [{ committedDate: "2026-01-01T00:00:00Z" }],
    comments: [],
    ...overrides,
  };
  return testHarness({
    env: { KORE_ROOT: "/repo" },
    responses: [
      {
        match: (c, a) => c === "gh" && a[1] === "view" && a[0] === "pr",
        result: { stdout: JSON.stringify(view) },
      },
      {
        match: (c, a) => c === "gh" && a[1] === "diff",
        result: { stdout: "" },
      },
      ...(runView === undefined ? [] : [runView]),
    ],
  });
}

const view = (result: FakeResponse["result"]): FakeResponse => ({
  match: (c, a) => c === "gh" && a[0] === "run",
  result,
});

describe("judge precheck edge cases", () => {
  it("reports coverage missing when gh run view fails", async () => {
    const h = pr({}, view({ code: 1, stderr: "boom" }));
    expect(await run(["judge", "precheck", "7", "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.out()).checks.coverage).toMatchObject({
      result: "missing",
    });
  });

  it("reports coverage missing when gh run view prints garbage", async () => {
    const h = pr({}, view({ stdout: "garbage" }));
    await run(["judge", "precheck", "7", "--json"], h.deps);
    expect(JSON.parse(h.out()).checks.coverage.detail).toContain("unreadable");
  });

  it("reports coverage pending while a step has no conclusion", async () => {
    const steps = ["Unit tests", "Harness tests"].map((name) => ({
      name,
      conclusion: "",
    }));
    const h = pr(
      {},
      view({ stdout: JSON.stringify({ jobs: [{ name: "check", steps }] }) }),
    );
    await run(["judge", "precheck", "7", "--json"], h.deps);
    expect(JSON.parse(h.out()).checks.coverage.result).toBe("pending");
  });

  it("reports coverage missing when the check has no run to read", async () => {
    const h = pr({
      statusCheckRollup: [{ ...job("check"), detailsUrl: "" }, job("scan")],
    });
    await run(["judge", "precheck", "7", "--json"], h.deps);
    expect(JSON.parse(h.out()).checks.coverage.result).toBe("missing");
  });

  it("does not trust any review when the PR lists no commit to compare against", async () => {
    const h = pr({
      commits: [],
      comments: [
        {
          body: "principles-review: No violations.",
          author: { login: "bot" },
          createdAt: "2026-01-02T00:00:00Z",
        },
      ],
    });
    await run(
      ["judge", "precheck", "7", "--json", "--reviewer", "bot"],
      h.deps,
    );
    expect(JSON.parse(h.out()).checks.principlesReview.result).toBe(
      "unverified",
    );
  });
});

describe("judge precheck readable output and errors", () => {
  it("prints the mismatch, details and unverified items in the readable summary", async () => {
    const h = pr({ body: "Safety pattern: feature-flagged" });
    expect(await run(["judge", "precheck", "7"], h.deps)).toBe(1);
    expect(h.out()).toContain("pattern mismatch:");
    expect(h.out()).toContain("unverified: gating not verified");
    expect(h.out()).toContain("principlesReview: missing (");
  });

  it("prints the readable reason for a missing declaration", async () => {
    const h = pr({ body: "nothing" });
    expect(await run(["judge", "precheck", "7"], h.deps)).toBe(1);
    expect(h.out()).toContain("Safety pattern:");
  });

  it("reports unreadable gh output as a JSON error under --json", async () => {
    const h = testHarness({
      env: { KORE_ROOT: "/repo" },
      responses: [{ match: () => true, result: { stdout: "garbage" } }],
    });
    expect(await run(["judge", "precheck", "7", "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.err().split("\n")[0] ?? "").error).toContain(
      "unreadable",
    );
  });
});
