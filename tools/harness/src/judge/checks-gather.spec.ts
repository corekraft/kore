import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { gatherChecks } from "./checks.js";
import {
  REVIEWERS,
  jobs,
  ok,
  review,
  rollupCheck,
  view,
} from "./checks-support.js";

const runner = { run: vi.fn<Runner["run"]>() };
const clean = [review("principles-review: No violations.")];
const gather = (pr: ReturnType<typeof view>) =>
  gatherChecks(runner, "/repo", "corekraft/kore", pr, REVIEWERS);

describe("gatherChecks reads CI, scan and the review", () => {
  it("passes every check when CI, scan and each coverage step succeeded", async () => {
    runner.run.mockResolvedValue(
      ok(
        jobs([
          { name: "Unit tests", conclusion: "success" },
          { name: "Harness tests", conclusion: "success" },
        ]),
      ),
    );
    const pr = view({
      rollup: [rollupCheck("check"), rollupCheck("scan")],
      comments: clean,
    });
    expect(await gather(pr)).toEqual({
      ci: { result: "pass" },
      scan: { result: "pass" },
      coverage: { result: "pass" },
      principlesReview: { result: "pass" },
    });
    expect(runner.run).toHaveBeenCalledExactlyOnceWith(
      "gh",
      ["run", "view", "777", "--repo", "corekraft/kore", "--json", "jobs"],
      { cwd: "/repo" },
    );
  });

  it("fails CI with its conclusion as the detail", async () => {
    const pr = view({
      rollup: [rollupCheck("check", "COMPLETED", "FAILURE", "")],
    });
    expect((await gather(pr)).ci).toEqual({
      result: "fail",
      detail: "check: FAILURE",
    });
  });

  it("is pending while scan is still running", async () => {
    const pr = view({ rollup: [rollupCheck("scan", "IN_PROGRESS", "", "")] });
    expect((await gather(pr)).scan).toEqual({
      result: "pending",
      detail: "scan: IN_PROGRESS",
    });
  });

  it("is missing when the PR has no check of that name", async () => {
    expect((await gather(view())).scan).toEqual({
      result: "missing",
      detail: 'no "scan" check on the PR',
    });
  });
});

describe("gatherChecks reads coverage from the CI run", () => {
  it("is missing, and calls no gh, when CI has no run URL", async () => {
    runner.run.mockClear();
    const pr = view({
      rollup: [rollupCheck("check", "COMPLETED", "SUCCESS", "")],
    });
    expect((await gather(pr)).coverage).toEqual({
      result: "missing",
      detail: "no CI run on the PR to read coverage out of",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("is missing when gh run view fails", async () => {
    runner.run.mockResolvedValue({ stdout: "", stderr: "boom", code: 1 });
    const pr = view({ rollup: [rollupCheck("check")] });
    expect((await gather(pr)).coverage).toEqual({
      result: "missing",
      detail: "gh run view 777 failed",
    });
  });

  it("is missing when gh returns output that is not JSON", async () => {
    runner.run.mockResolvedValue(ok("not json"));
    const pr = view({ rollup: [rollupCheck("check")] });
    expect((await gather(pr)).coverage).toEqual({
      result: "missing",
      detail: "gh run view 777 returned unreadable output",
    });
  });

  it("is missing when a coverage step is absent from the run", async () => {
    runner.run.mockResolvedValue(
      ok(jobs([{ name: "Unit tests", conclusion: "success" }])),
    );
    const pr = view({ rollup: [rollupCheck("check")] });
    expect((await gather(pr)).coverage).toEqual({
      result: "missing",
      detail: 'no "Harness tests" step in run 777',
    });
  });

  it("fails coverage naming the step whose conclusion is not success", async () => {
    runner.run.mockResolvedValue(
      ok(
        jobs([
          { name: "Unit tests", conclusion: "failure" },
          { name: "Harness tests", conclusion: "success" },
        ]),
      ),
    );
    const pr = view({ rollup: [rollupCheck("check")] });
    expect((await gather(pr)).coverage).toEqual({
      result: "fail",
      detail: "Unit tests: failure",
    });
  });

  it("is pending coverage while a step has no conclusion yet", async () => {
    runner.run.mockResolvedValue(
      ok(
        jobs([
          { name: "Unit tests", conclusion: "" },
          { name: "Harness tests", conclusion: "success" },
        ]),
      ),
    );
    const pr = view({ rollup: [rollupCheck("check")] });
    expect((await gather(pr)).coverage).toEqual({
      result: "pending",
      detail: "Unit tests: not finished",
    });
  });
});
