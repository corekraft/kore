import { describe, expect, it } from "vitest";
import type { CostMetric, FlowReport } from "../flow/index.js";
import { trailingOf } from "./trailing.js";

const ok = { status: "ok", current: 1 } as unknown as CostMetric;
const short = { status: "insufficient history" } as unknown as CostMetric;

describe("trailingOf", () => {
  it("keys every metric that has a trailing status by its dotted report path", () => {
    const report = {
      metrics: { trailingIdeas: 5, tokensPerIdea: ok, sessionsPerIdea: short },
      rework: { sendBacksPerIdea: ok, note: "x" },
      leadTime: { medianSeconds: 3 },
    } as unknown as FlowReport;

    expect(trailingOf(report)).toEqual({
      "metrics.tokensPerIdea": ok,
      "metrics.sessionsPerIdea": short,
      "rework.sendBacksPerIdea": ok,
    });
  });
});
