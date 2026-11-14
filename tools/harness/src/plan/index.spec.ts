import { describe, expect, it, vi } from "vitest";
import * as active from "./active.js";
import * as next from "./next.js";
import * as parser from "./parser.js";
import * as store from "./store.js";
import * as tick from "./tick.js";
import * as plan from "./index.js";

// The barrel re-exports; each module it names is an automock, so this spec runs none of them.
vi.mock("./active.js");
vi.mock("./next.js");
vi.mock("./parser.js");
vi.mock("./store.js");
vi.mock("./tick.js");

describe("plan barrel", () => {
  it("exposes exactly the public names, and no internal helper", () => {
    expect(Object.keys(plan).sort()).toEqual([
      "activePlans",
      "listItemSpans",
      "listItems",
      "nextBlocks",
      "nextStep",
      "openCounts",
      "openItems",
      "planActive",
      "planClearNext",
      "planNext",
      "planStatus",
      "planTick",
      "readActivePlans",
      "readPlans",
      "upcomingSteps",
    ]);
  });

  it("re-exports the same commands and readers each module defines", () => {
    expect(plan.planActive).toBe(active.planActive);
    expect(plan.readActivePlans).toBe(active.readActivePlans);
    expect(plan.planNext).toBe(next.planNext);
    expect(plan.planClearNext).toBe(next.planClearNext);
    expect(plan.planTick).toBe(tick.planTick);
    expect(plan.readPlans).toBe(store.readPlans);
  });

  it("re-exports the parser helpers unchanged", () => {
    expect(plan.activePlans).toBe(parser.activePlans);
    expect(plan.listItemSpans).toBe(parser.listItemSpans);
    expect(plan.listItems).toBe(parser.listItems);
    expect(plan.nextBlocks).toBe(parser.nextBlocks);
    expect(plan.nextStep).toBe(parser.nextStep);
    expect(plan.openCounts).toBe(parser.openCounts);
    expect(plan.openItems).toBe(parser.openItems);
    expect(plan.planStatus).toBe(parser.planStatus);
    expect(plan.upcomingSteps).toBe(parser.upcomingSteps);
  });
});
