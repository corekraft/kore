import { describe, expect, it } from "vitest";
import { judgeChange, readMetric } from "./judge.js";

describe("readMetric", () => {
  const report = {
    leadTime: { medianSeconds: 120 },
    outcomes: { mainRed: { rate: 0.2, runs: 5 } },
    metrics: {
      tokensPerIdea: {
        status: "ok",
        current: 900,
        trailingAverage: 1000,
      },
      sessionsPerIdea: { status: "insufficient history" },
    },
    empty: null,
  };

  it("reads a number at a dotted path", () => {
    expect(readMetric(report, "outcomes.mainRed.rate")).toBe(0.2);
  });

  it("reads the current value of a cost metric that has history", () => {
    expect(readMetric(report, "metrics.tokensPerIdea")).toBe(900);
  });

  it("reads nothing from a cost metric with insufficient history", () => {
    expect(readMetric(report, "metrics.sessionsPerIdea")).toBeNull();
  });

  it("reads nothing from a null, a missing path or a non-metric object", () => {
    expect(readMetric(report, "empty")).toBeNull();
    expect(readMetric(report, "nope.at.all")).toBeNull();
    expect(readMetric(report, "leadTime")).toBeNull();
  });
});

describe("judgeChange", () => {
  it("confirms a metric that rose past the threshold when up was expected", () => {
    expect(
      judgeChange({ direction: "up", before: 10, after: 12, threshold: 0.1 })
        .result,
    ).toBe("confirmed");
  });

  it("confirms a metric that fell past the threshold when down was expected", () => {
    expect(
      judgeChange({ direction: "down", before: 10, after: 8, threshold: 0.1 })
        .result,
    ).toBe("confirmed");
  });

  it("refutes a metric that moved the opposite way past the threshold, up and down", () => {
    expect(
      judgeChange({ direction: "up", before: 10, after: 8, threshold: 0.1 })
        .result,
    ).toBe("refuted");
    expect(
      judgeChange({ direction: "down", before: 10, after: 12, threshold: 0.1 })
        .result,
    ).toBe("refuted");
  });

  it("is inconclusive for a move within the noise threshold either way", () => {
    expect(
      judgeChange({ direction: "up", before: 10, after: 10.5, threshold: 0.1 })
        .result,
    ).toBe("inconclusive");
    expect(
      judgeChange({
        direction: "down",
        before: 10,
        after: 10.5,
        threshold: 0.1,
      }).result,
    ).toBe("inconclusive");
  });

  it("counts a move of exactly the threshold as past it", () => {
    expect(
      judgeChange({ direction: "up", before: 10, after: 11, threshold: 0.1 })
        .result,
    ).toBe("confirmed");
  });

  it.each([
    [null, 5],
    [5, null],
    [null, null],
    [0, 5],
  ])(
    "is inconclusive, never confirmed, when before is %s and after is %s",
    (before, after) => {
      const judged = judgeChange({
        direction: "up",
        before,
        after,
        threshold: 0.1,
      });
      expect(judged.result).toBe("inconclusive");
      expect(judged.change).toBeNull();
      expect(judged.reason).toBe("insufficient history");
    },
  );

  it("reports the relative change it judged", () => {
    expect(
      judgeChange({ direction: "down", before: 10, after: 8, threshold: 0.1 })
        .change,
    ).toBeCloseTo(-0.2);
  });
});
