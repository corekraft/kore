import { describe, expect, it } from "vitest";
import { bad, isObject } from "./cost-config-support.js";

describe("bad: the one failure message of the harness config", () => {
  it("names the file, the key and the fix", () => {
    expect(bad(".claude/harness.json", "cost.x", "must be 1. Fix it.")).toEqual(
      {
        error: 'Invalid .claude/harness.json: key "cost.x" must be 1. Fix it.',
      },
    );
  });
});

describe("isObject: a plain JSON object", () => {
  it.each([{}, { a: 1 }])("accepts %j", (value) => {
    expect(isObject(value)).toBe(true);
  });

  it.each([null, [], [1], "x", 3, undefined, true])("refuses %j", (value) => {
    expect(isObject(value)).toBe(false);
  });
});
