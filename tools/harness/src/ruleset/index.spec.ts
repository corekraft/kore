import { describe, expect, it, vi } from "vitest";
import * as commands from "./commands.js";
import * as index from "./index.js";
import * as weaken from "./weaken.js";

vi.mock("./commands.js", () => ({
  rulesetCommands: { sync: {}, insights: {} },
}));
vi.mock("./weaken.js", () => ({
  declaredFields: vi.fn(),
  weaker: vi.fn(),
  weakenings: vi.fn(),
}));

describe("the ruleset barrel exposes the command table and the weakening helpers", () => {
  it("exports exactly the four names other domains import", () => {
    expect(Object.keys(index).sort()).toEqual([
      "declaredFields",
      "rulesetCommands",
      "weakenings",
      "weaker",
    ]);
  });

  it("re-exports the command table of its commands unit, unchanged", () => {
    expect(index.rulesetCommands).toBe(commands.rulesetCommands);
  });

  it("re-exports the weakening helpers of its weaken unit, unchanged", () => {
    expect(index.weakenings).toBe(weaken.weakenings);
    expect(index.weaker).toBe(weaken.weaker);
    expect(index.declaredFields).toBe(weaken.declaredFields);
  });
});
