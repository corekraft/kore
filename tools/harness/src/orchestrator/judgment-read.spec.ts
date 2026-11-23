import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPlanFromReport } from "./judgment-report.js";
import { NO_SUMMARY, readPlanOf, readSummaryOf } from "./judgment-read.js";

vi.mock("./judgment-report.js", () => ({ readPlanFromReport: vi.fn() }));

const PLAN = { stop: { reason: "owner decides" } };

function reads(report?: { summary: string; plan?: string }) {
  return { reportOf: vi.fn(async () => report) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readPlanFromReport).mockReturnValue({ ok: true, raw: PLAN });
});

describe("readPlanOf: a judgment's plan is the one its report carries", () => {
  it("reads the plan the report carries", async () => {
    const r = reads({ summary: "plan written", plan: "{}" });

    expect(await readPlanOf(r, "idea-0007-judgment-r1")).toStrictEqual({
      ok: true,
      raw: PLAN,
    });
    expect(readPlanFromReport).toHaveBeenCalledWith("{}");
  });

  it("reads no plan when the session wrote no report, so the tick refuses it by name", async () => {
    await readPlanOf(reads(), "idea-0007-judgment-r1");

    expect(readPlanFromReport).toHaveBeenCalledWith(undefined);
  });
});

describe("readSummaryOf: a reader's answer is the summary its report carries", () => {
  it("gives the report's summary as it is", async () => {
    const r = reads({ summary: "the answer" });

    expect(await readSummaryOf(r, "idea-0007-read-r1-q1")).toBe("the answer");
  });

  it("says the reader wrote no report when it wrote none, so the judgment still sees it", async () => {
    expect(await readSummaryOf(reads(), "idea-0007-read-r1-q1")).toBe(
      NO_SUMMARY,
    );
  });
});
