// The reporter that writes the report the test-budget hook reads. The unit is
// the reporter; the clock and the file write are injected, vitest is not run.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import {
  BudgetReporter,
  type ModuleLike,
  type TestCaseLike,
} from "./test-budget-reporter.js";

const test = (
  fullName: string,
  duration: number | undefined,
): TestCaseLike => ({
  fullName,
  diagnostic: () => (duration === undefined ? undefined : { duration }),
});

const module_ = (
  moduleId: string,
  diagnostic: ModuleLike["diagnostic"] extends () => infer D ? D : never,
  tests: TestCaseLike[],
): ModuleLike => ({
  moduleId,
  diagnostic: () => diagnostic,
  children: { allTests: () => tests.values() },
});

const timings = (collect: number, tests: number) => ({
  environmentSetupDuration: 0,
  prepareDuration: 0,
  setupDuration: 0,
  collectDuration: collect,
  duration: tests,
});

function run(modules: ModuleLike[], clock: [number, number] = [1000, 1500]) {
  const write = vi.fn<(path: string, text: string) => void>();
  const remove = vi.fn<(path: string) => void>();
  const now = vi.fn<() => number>();
  now.mockReturnValueOnce(clock[0]).mockReturnValueOnce(clock[1]);
  const reporter = new BudgetReporter({
    outputFile: "out/unit.json",
    write,
    remove,
    now,
  });
  reporter.onInit();
  reporter.onTestRunEnd(modules);
  const text = write.mock.calls[0]?.[1];
  return {
    write,
    remove,
    report: text === undefined ? undefined : JSON.parse(text),
  };
}

describe("BudgetReporter", () => {
  it("counts a file's import and collection time, not only its test bodies", () => {
    const { report } = run([
      module_("/r/a.spec.ts", timings(900, 20), [test("a works", 20)]),
    ]);
    expect(report.files).toEqual([
      { name: "/r/a.spec.ts", ms: 920, tests: [{ name: "a works", ms: 20 }] },
    ]);
  });

  it("counts environment, harness and setup-file time in the file's time", () => {
    const { report } = run([
      module_(
        "/r/a.spec.ts",
        {
          environmentSetupDuration: 1,
          prepareDuration: 2,
          setupDuration: 4,
          collectDuration: 8,
          duration: 16,
        },
        [],
      ),
    ]);
    expect(report.files[0].ms).toBe(31);
  });

  it("measures the run from reporter start to run end, so startup and global setup count", () => {
    const { report } = run([], [1000, 23_500]);
    expect(report.runMs).toBe(22_500);
  });

  it("writes to the configured file and reports a test with no duration as zero", () => {
    const { write, report } = run([
      module_("/r/a.spec.ts", timings(0, 0), [test("skipped", undefined)]),
    ]);
    expect(write.mock.calls[0]?.[0]).toBe("out/unit.json");
    expect(report.files[0].tests).toEqual([{ name: "skipped", ms: 0 }]);
  });

  it("removes the last run's report when a run starts, so a run that writes none cannot be judged by the old file", () => {
    const { write, remove } = run([]);
    expect(remove.mock.calls).toEqual([["out/unit.json"]]);
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
