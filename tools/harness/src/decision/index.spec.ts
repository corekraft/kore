import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import * as decision from "./decision.js";
import * as flag from "./flag.js";
import * as reserved from "./reserved.js";

vi.mock("./decision.js", () => ({
  DECISION_FLAG: "decision-advisor",
  DecisionError: class DecisionError extends Error {},
  makeDecision: vi.fn(),
}));
vi.mock("./flag.js", () => ({ decisionFlagOn: vi.fn() }));
vi.mock("./reserved.js", () => ({
  RESERVED_CATEGORIES: [],
  reservedCategory: vi.fn(),
}));

describe("the decision barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "DECISION_FLAG",
      "DecisionError",
      "RESERVED_CATEGORIES",
      "decisionFlagOn",
      "makeDecision",
      "reservedCategory",
    ]);
  });

  it("re-exports each unit's own names, not copies", () => {
    expect(barrel.makeDecision).toBe(decision.makeDecision);
    expect(barrel.DecisionError).toBe(decision.DecisionError);
    expect(barrel.decisionFlagOn).toBe(flag.decisionFlagOn);
    expect(barrel.reservedCategory).toBe(reserved.reservedCategory);
    expect(barrel.RESERVED_CATEGORIES).toBe(reserved.RESERVED_CATEGORIES);
  });
});
