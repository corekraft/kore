import { describe, expect, it } from "vitest";
import { HOST_RULES } from "./schema-host.js";

const rule = (field: string) => {
  const found = HOST_RULES.find((candidate) => candidate.field === field);
  if (found === undefined) {
    throw new Error(`no rule for ${field}`);
  }
  return found;
};

describe("host-sample rules", () => {
  it("covers exactly the five payload fields, all on host-sample only", () => {
    expect(HOST_RULES.map((r) => r.field)).toEqual([
      "load",
      "memory",
      "swap",
      "sessions",
      "platform",
    ]);
    for (const r of HOST_RULES) {
      expect(r.kinds).toEqual(["host-sample"]);
    }
  });

  it("makes load, memory and swap optional and the count and flag required", () => {
    expect(
      HOST_RULES.filter((r) => "optional" in r).map((r) => r.field),
    ).toEqual(["load", "memory", "swap"]);
  });

  it.each([
    ["load", [0, 3.25], [-1, Infinity, NaN, "1"]],
    ["memory", [0, 0.4, 1], [-0.1, 1.1, "0.5"]],
    ["swap", [0, 2048], [-1, 1.5, "1"]],
    ["sessions", [0, 3], [-1, 1.5, "2"]],
    ["platform", [true, false], [1, "true"]],
  ])("checks %s", (field, good, bad) => {
    for (const value of good) {
      expect(rule(field).check(value)).toBe(true);
    }
    for (const value of bad) {
      expect(rule(field).check(value)).toBe(false);
    }
  });
});
