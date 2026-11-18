import { describe, expect, it, vi } from "vitest";
import { splitFiguresAt, splitSpanAt } from "./date-split.js";
import type { Span } from "./scope.js";

const CUT = new Date("2026-11-16T00:00:00Z");
const CUT_MS = CUT.getTime();

describe("splitSpanAt: a span cut at a date into the time before it and the time on or after it", () => {
  it("ends the before side at the date and starts the after side at it, keeping the span's outer bounds", () => {
    const span: Span = [CUT_MS - 1000, CUT_MS + 5000];

    expect(splitSpanAt(span, CUT)).toEqual({
      before: [CUT_MS - 1000, CUT_MS],
      after: [CUT_MS, CUT_MS + 5000],
    });
  });

  it("keeps an open end open on its own side", () => {
    expect(splitSpanAt([-Infinity, Infinity], CUT)).toEqual({
      before: [-Infinity, CUT_MS],
      after: [CUT_MS, Infinity],
    });
  });

  it("leaves the moment of the date to the after side only, because a span includes its start and not its end", () => {
    const { before, after } = splitSpanAt([-Infinity, Infinity], CUT);

    // The same rule as `ledger list` and the report's --since and --until: from inclusive, to exclusive.
    const inSpan = (span: Span, at: number) => at >= span[0] && at < span[1];
    expect([inSpan(before, CUT_MS), inSpan(after, CUT_MS)]).toEqual([
      false,
      true,
    ]);
    expect([inSpan(before, CUT_MS - 1), inSpan(after, CUT_MS - 1)]).toEqual([
      true,
      false,
    ]);
  });

  it("gives an empty before side when the date is at or before the span's start", () => {
    const span: Span = [CUT_MS, CUT_MS + 5000];

    expect(splitSpanAt(span, new Date(CUT_MS - 9999))).toEqual({
      before: [CUT_MS, CUT_MS],
      after: [CUT_MS, CUT_MS + 5000],
    });
  });

  it("gives an empty after side when the date is at or after the span's end", () => {
    const span: Span = [CUT_MS - 5000, CUT_MS];

    expect(splitSpanAt(span, new Date(CUT_MS + 9999))).toEqual({
      before: [CUT_MS - 5000, CUT_MS],
      after: [CUT_MS, CUT_MS],
    });
  });
});

describe("splitFiguresAt: the same figures read over each side of a date", () => {
  it("reads the figures once over the before side and once over the after side, and names the date as an ISO time", () => {
    const figures = vi.fn((span: Span) => `read ${span[0]} to ${span[1]}`);

    const split = splitFiguresAt([0, CUT_MS + 10], CUT, figures);

    expect(split).toEqual({
      at: "2026-11-16T00:00:00.000Z",
      before: `read 0 to ${CUT_MS}`,
      after: `read ${CUT_MS} to ${CUT_MS + 10}`,
    });
    expect(figures).toHaveBeenCalledTimes(2);
  });
});
