import { describe, expect, it } from "vitest";
import { undocumented } from "./exemptions.js";

describe("the exemption list", () => {
  it("names each command once, one per line, with no blank line or stray space", () => {
    expect(new Set(undocumented).size).toBe(undocumented.length);
    for (const line of undocumented) {
      expect(line).not.toBe("");
      expect(line).toBe(line.trim());
    }
  });
});
