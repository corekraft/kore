import { describe, expect, it } from "vitest";
import { minCategorisedSendBacksOf } from "./cost-config-send-backs.js";

const FILE = ".claude/harness.json";

describe("minCategorisedSendBacksOf: the categorised send-back minimum of the harness config (#1094)", () => {
  it("takes the proposed 20 when the config leaves the key out", () => {
    expect(minCategorisedSendBacksOf(FILE, undefined)).toBe(20);
  });

  it.each([1, 20, 500])("reads %j, a whole number of at least 1", (value) => {
    expect(minCategorisedSendBacksOf(FILE, value)).toBe(value);
  });

  it.each([0, -3, 1.5, Number.NaN, Infinity, 2 ** 60, "20", null, true, []])(
    "refuses %j, naming the file and the key and giving the fix",
    (value) => {
      expect(minCategorisedSendBacksOf(FILE, value)).toEqual({
        error:
          'Invalid .claude/harness.json: key "cost.minCategorisedSendBacks" must be a whole number of at least 1 (20 is proposed). Fix the value, or remove the key to use 20.',
      });
    },
  );
});
