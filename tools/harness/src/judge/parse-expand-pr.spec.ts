import { describe, expect, it } from "vitest";
import { parseExpandPr } from "./parse-expand-pr.js";

const EXPAND_MERGED = "2026-11-14T15:19:20Z";

describe("parseExpandPr reads the merge time of an expand PR", () => {
  it("reads the merge time of a merged PR", () => {
    expect(parseExpandPr(JSON.stringify({ mergedAt: EXPAND_MERGED }))).toEqual({
      mergedAt: EXPAND_MERGED,
    });
  });

  it("reads no merge time, not an error, for a PR that is not merged", () => {
    expect(parseExpandPr(JSON.stringify({ mergedAt: null }))).toEqual({
      mergedAt: undefined,
    });
  });

  it("reads no merge time from a view that has no mergedAt field", () => {
    expect(parseExpandPr("{}")).toEqual({ mergedAt: undefined });
  });

  it("returns undefined for output that is not JSON, so the caller can name the gh failure", () => {
    expect(parseExpandPr("nope")).toBeUndefined();
  });
});
