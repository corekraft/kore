import { describe, expect, it } from "vitest";
import { clipMs, inWindow, scopeOf, windowOf } from "./scope.js";

describe("scopeOf", () => {
  it("states open ends as null and no idea filter when none is given", () => {
    expect(scopeOf({})).toEqual({ since: null, until: null, ideas: null });
  });

  it("states the range as ISO times", () => {
    expect(
      scopeOf({
        since: new Date("2026-01-02T00:00:00.000Z"),
        until: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      until: "2026-01-03T00:00:00.000Z",
      ideas: null,
    });
  });

  it("keeps an empty idea filter as an empty list, not as every idea", () => {
    expect(scopeOf({ ideas: [] }).ideas).toEqual([]);
  });

  it("deduplicates the ideas and orders them by issue number", () => {
    expect(scopeOf({ ideas: ["#10", "#2", "#2", "#9"] }).ideas).toEqual([
      "#2",
      "#9",
      "#10",
    ]);
  });
});

describe("windowOf", () => {
  it("is infinite on each open end", () => {
    expect(windowOf({})).toEqual([-Infinity, Infinity]);
  });

  it("is the range in milliseconds", () => {
    expect(windowOf({ since: new Date(5), until: new Date(9) })).toEqual([
      5, 9,
    ]);
  });
});

describe("clipMs", () => {
  it("is the part of the interval inside the window", () => {
    expect(clipMs([10, 20], 15, 25)).toBe(5);
    expect(clipMs([10, 20], 0, 30)).toBe(10);
  });

  it("is zero for an interval outside the window or only touching its edge", () => {
    expect(clipMs([10, 20], 20, 30)).toBe(0);
    expect(clipMs([10, 20], 0, 10)).toBe(0);
  });
});

describe("inWindow", () => {
  it("includes the start and excludes the end", () => {
    expect(inWindow([10, 20], 10)).toBe(true);
    expect(inWindow([10, 20], 20)).toBe(false);
  });
});
