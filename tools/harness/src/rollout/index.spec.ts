import { describe, expect, it, vi } from "vitest";
import * as drift from "./drift.js";
import * as index from "./index.js";
import * as locks from "./locks.js";

vi.mock("./drift.js", () => ({
  compareRollout: vi.fn(),
  parseChartRows: vi.fn(),
}));
vi.mock("./locks.js", () => ({
  RolloutError: class RolloutError extends Error {},
  readRolloutLocks: vi.fn(),
}));

describe("the rollout barrel", () => {
  it("exposes exactly the lock reader, its error and the drift comparison", () => {
    expect(Object.keys(index).sort()).toEqual([
      "RolloutError",
      "compareRollout",
      "parseChartRows",
      "readRolloutLocks",
    ]);
  });

  it("re-exports each unit's own function, not a copy", () => {
    expect(index.readRolloutLocks).toBe(locks.readRolloutLocks);
    expect(index.RolloutError).toBe(locks.RolloutError);
    expect(index.compareRollout).toBe(drift.compareRollout);
    expect(index.parseChartRows).toBe(drift.parseChartRows);
  });
});
