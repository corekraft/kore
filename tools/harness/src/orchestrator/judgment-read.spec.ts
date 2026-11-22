import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPlan } from "./judgment-plan.js";
import { readPlanFromReport } from "./judgment-report.js";
import { readSummary } from "./judgment-summary.js";
import { readPlanOf, readSummaryOf } from "./judgment-read.js";

vi.mock("./judgment-plan.js", () => ({ readPlan: vi.fn() }));
vi.mock("./judgment-report.js", () => ({ readPlanFromReport: vi.fn() }));
vi.mock("./judgment-summary.js", () => ({ readSummary: vi.fn() }));

const PLAN = { stop: { reason: "owner decides" } };

function reads(
  over: {
    report?: { summary: string; plan?: string };
    pane?: string;
  } = {},
) {
  return {
    reportOf: vi.fn(async () => over.report),
    paneText: vi.fn(async () => over.pane ?? "pane text"),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readPlan).mockReturnValue({ ok: true, raw: { from: "pane" } });
  vi.mocked(readPlanFromReport).mockReturnValue({ ok: true, raw: PLAN });
  vi.mocked(readSummary).mockImplementation((text) => `S(${text})`);
});

describe("readPlanOf: a judgment's plan comes from its report when it has one", () => {
  it("reads the plan the report carries, and reads no pane", async () => {
    const r = reads({ report: { summary: "plan written", plan: "{}" } });

    expect(await readPlanOf(r, "idea-0007-judgment-r1")).toStrictEqual({
      ok: true,
      raw: PLAN,
    });
    expect(readPlanFromReport).toHaveBeenCalledWith("{}");
    expect(r.paneText).not.toHaveBeenCalled();
  });

  it("reads the pane's plan markers when no report exists, as a herdr pane's plan is read", async () => {
    const r = reads({ pane: "PLAN-JSON" });

    expect(await readPlanOf(r, "idea-0007-judgment-r1")).toStrictEqual({
      ok: true,
      raw: { from: "pane" },
    });
    expect(readPlan).toHaveBeenCalledWith("PLAN-JSON");
    expect(readPlanFromReport).not.toHaveBeenCalled();
  });
});

describe("readSummaryOf: a reader's answer comes from its report when it has one", () => {
  it("gives the report's summary as it is, with no summary markers to find", async () => {
    const r = reads({ report: { summary: "the answer" } });

    expect(await readSummaryOf(r, "idea-0007-read-r1-q1")).toBe("the answer");
    expect(readSummary).not.toHaveBeenCalled();
    expect(r.paneText).not.toHaveBeenCalled();
  });

  it("reads the summary markers from the pane when no report exists", async () => {
    const r = reads({ pane: "SUMMARY-BEGIN" });

    expect(await readSummaryOf(r, "idea-0007-read-r1-q1")).toBe(
      "S(SUMMARY-BEGIN)",
    );
    expect(readSummary).toHaveBeenCalledWith("SUMMARY-BEGIN");
  });
});
