import { describe, expect, it } from "vitest";
import { GUARD_METRICS, flowMetricNames } from "./metric-names.js";

describe("GUARD_METRICS", () => {
  it("names the shared metrics ADR 0119 lists, per idea and per merged change", () => {
    expect(GUARD_METRICS).toEqual([
      "metrics.tokensPerIdea",
      "tokensPerMergedChange.current",
      "rework.sendBacksPerIdea",
      "sendBacksPerMergedChange.current",
      "friction.total",
      "rework.frictionPerIdea",
      "outcomes.ownerMinutes.perMerged",
      "leadTime.medianSeconds",
      "leadTimePerMergedChange.current",
    ]);
  });

  it("holds only metrics the flow report names, so the list cannot drift from the report", () => {
    const known = flowMetricNames();
    for (const metric of GUARD_METRICS) {
      expect(known, `${metric} is not a flow report metric`).toContain(metric);
    }
  });
});
