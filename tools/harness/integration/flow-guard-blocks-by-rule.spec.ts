import { describe, expect, it } from "vitest";
import { buildReport, flowMetricNames } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

describe("flow report guard blocks per rule (#984)", () => {
  it("names guardBlocksByRule.role-no-merge among the flow metrics from an empty ledger", () => {
    expect(flowMetricNames()).toContain("guardBlocksByRule.role-no-merge");
  });

  it("counts each rule's blocks in the report, and a rule with none stays at zero", () => {
    const r = buildReport(
      [
        at(0, "guard.block", { label: "role-no-merge" }),
        at(1, "guard.block", { label: "role-no-merge" }),
      ],
      { asOf: ASOF, minCompletedIdeas: 1 },
    );
    expect(r.guardBlocksByRule["role-no-merge"]).toBe(2);
    expect(r.guardBlocksByRule["role-worktree"]).toBe(0);
  });
});
