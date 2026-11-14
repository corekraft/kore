import { describe, expect, it } from "vitest";
import { trimCommon, type Edit } from "./edits.js";

const LINES = ["a", "b", "c", "d"];

describe("trimCommon", () => {
  it("returns null when the edit replaces lines with the same lines", () => {
    const edit: Edit = { start: 1, end: 3, lines: ["b", "c"] };
    expect(trimCommon(edit, LINES)).toBeNull();
  });

  it("keeps only the lines that differ, at their own line numbers", () => {
    const edit: Edit = { start: 0, end: 4, lines: ["a", "X", "c", "d"] };
    expect(trimCommon(edit, LINES)).toEqual({
      start: 1,
      end: 2,
      lines: ["X"],
    });
  });

  it("reports a pure insertion as an empty range that gains the new lines", () => {
    const edit: Edit = { start: 1, end: 1, lines: ["X"] };
    expect(trimCommon(edit, LINES)).toEqual({
      start: 1,
      end: 1,
      lines: ["X"],
    });
  });

  it("reports a pure removal with its range and no new lines", () => {
    const edit: Edit = { start: 1, end: 3, lines: [] };
    expect(trimCommon(edit, LINES)).toEqual({
      start: 1,
      end: 3,
      lines: [],
    });
  });

  it("trims a shared head and tail around an insertion", () => {
    const edit: Edit = { start: 0, end: 3, lines: ["a", "X", "b", "c"] };
    expect(trimCommon(edit, LINES)).toEqual({
      start: 1,
      end: 1,
      lines: ["X"],
    });
  });
});
