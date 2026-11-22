// The nearest real name a document's unknown command or flag is compared with.
import { describe, expect, it } from "vitest";
import { nearest } from "./nearest.js";

describe("nearest", () => {
  it("returns the candidate one edit away from a misspelt command", () => {
    expect(nearest("pr opne", ["pr open", "pr check", "flag activate"])).toBe(
      "pr open",
    );
  });

  it("returns an exact match over any other candidate", () => {
    expect(nearest("kb-check", ["kb-chek", "kb-check"])).toBe("kb-check");
  });

  it("keeps the earlier candidate when two are equally near", () => {
    expect(nearest("titl", ["tile", "trail"])).toBe("tile");
  });

  it("returns undefined when there are no candidates", () => {
    expect(nearest("pr open", [])).toBeUndefined();
  });
});
