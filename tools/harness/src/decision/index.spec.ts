import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import * as decision from "./decision.js";
import * as flag from "./flag.js";
import * as reserved from "./reserved.js";
import * as route from "./route.js";

vi.mock("./decision.js", () => ({
  CATEGORY_NAME: /^x$/,
  DECISION_FLAG: "decision-advisor",
  DecisionError: class DecisionError extends Error {},
  makeDecision: vi.fn(),
}));
vi.mock("./flag.js", () => ({ decisionFlagOn: vi.fn() }));
vi.mock("./reserved.js", () => ({
  RESERVED_CATEGORIES: [],
  reservedCategory: vi.fn(),
}));
vi.mock("./route.js", () => ({
  UNCLASSIFIED: "unclassified",
  classify: vi.fn(),
  routeQuestion: vi.fn(),
}));

describe("the decision barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "ASK_LABEL",
      "DECISION_FLAG",
      "DIGEST_INTERVAL_MS",
      "DecisionError",
      "RESERVED_CATEGORIES",
      "UNCLASSIFIED",
      "askOwner",
      "classify",
      "decisionFlagOn",
      "digestDue",
      "makeDecision",
      "openOwnerQuestions",
      "pinnedDigestIssue",
      "postDigest",
      "reservedCategory",
      "routeQuestion",
    ]);
  });

  it("re-exports each unit's own names, not copies", () => {
    expect(barrel.makeDecision).toBe(decision.makeDecision);
    expect(barrel.DecisionError).toBe(decision.DecisionError);
    expect(barrel.decisionFlagOn).toBe(flag.decisionFlagOn);
    expect(barrel.reservedCategory).toBe(reserved.reservedCategory);
    expect(barrel.RESERVED_CATEGORIES).toBe(reserved.RESERVED_CATEGORIES);
    expect(barrel.routeQuestion).toBe(route.routeQuestion);
    expect(barrel.classify).toBe(route.classify);
    expect(barrel.UNCLASSIFIED).toBe(route.UNCLASSIFIED);
  });
});
