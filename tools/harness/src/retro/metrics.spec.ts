// Which flow-report metrics a retro can be triggered by.
import { describe, expect, it } from "vitest";
import type { CostMetric, FlowReport } from "../flow/index.js";
import { metricsOf } from "./metrics.js";

const ok = (idea: string, worsened: boolean): CostMetric => ({
  status: "ok",
  currentIdea: idea,
  current: 2,
  trailingAverage: 1,
  maxIncrease: 0.25,
  worsened,
});
const thin: CostMetric = {
  status: "insufficient history",
  closedIdeas: 1,
  needed: 6,
};

// The cast stands in for the report fields a retro never reads.
const report = (
  metrics: Record<string, CostMetric>,
  rework: Record<string, CostMetric>,
) => ({ metrics, rework }) as unknown as FlowReport;

describe("metricsOf", () => {
  it("names every metric with enough history, by its report name, with the idea it measures", () => {
    expect(
      metricsOf(
        report(
          {
            trailingIdeas: 5 as never,
            tokensPerIdea: ok("0003", true),
            sessionsPerIdea: ok("0003", false),
          },
          { trailingIdeas: 5 as never, sendBacksPerIdea: ok("0003", true) },
        ),
      ),
    ).toEqual([
      { name: "tokensPerIdea", idea: "0003", worsened: true },
      { name: "sessionsPerIdea", idea: "0003", worsened: false },
      { name: "sendBacksPerIdea", idea: "0003", worsened: true },
    ]);
  });

  it("leaves out a metric without history, so thin data never triggers a retro", () => {
    expect(
      metricsOf(report({ tokensPerIdea: thin }, { frictionPerIdea: thin })),
    ).toEqual([]);
  });
});
