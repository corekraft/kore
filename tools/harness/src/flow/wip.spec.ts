import { describe, expect, it } from "vitest";
import { median, widen, wipOf } from "./wip.js";

describe("wipOf", () => {
  it("is zero for no spans", () => {
    expect(wipOf([], [0, 100])).toEqual({ peak: 0, average: 0 });
  });

  it("gives one open idea a peak of 1 and its share of the range as the average", () => {
    expect(wipOf([[0, 50]], [0, 100])).toEqual({ peak: 1, average: 0.5 });
  });

  it("ignores a span that opens and closes at the same instant", () => {
    expect(wipOf([[10, 10]], [0, 100])).toEqual({ peak: 0, average: 0 });
  });

  it("finds the peak and the time-weighted average of overlapping spans", () => {
    expect(
      wipOf(
        [
          [0, 100],
          [50, 150],
        ],
        [0, 150],
      ),
    ).toEqual({ peak: 2, average: 1.3333 });
  });

  it("does not overlap a span that closes where the next opens", () => {
    expect(
      wipOf(
        [
          [0, 100],
          [100, 200],
        ],
        [0, 200],
      ),
    ).toEqual({ peak: 1, average: 1 });
  });

  it("gives the same result whatever order the spans come in", () => {
    expect(
      wipOf(
        [
          [50, 150],
          [0, 100],
        ],
        [0, 150],
      ),
    ).toEqual({ peak: 2, average: 1.3333 });
  });

  it("rounds the average to four decimal places", () => {
    expect(wipOf([[0, 100]], [0, 300])).toEqual({ peak: 1, average: 0.3333 });
  });

  it("averages to zero over an empty range, though the peak still counts", () => {
    expect(wipOf([[0, 10]], [5, 5])).toEqual({ peak: 1, average: 0 });
  });
});

describe("widen", () => {
  it("returns a copy of the span when there is nothing to widen into", () => {
    const span: [number, number] = [1, 2];
    const result = widen(undefined, span);
    expect(result).toEqual([1, 2]);
    expect(result).not.toBe(span);
  });

  it("extends the interval to the earlier start of the two", () => {
    expect(widen([5, 10], [1, 3])).toEqual([1, 10]);
  });

  it("keeps the interval unchanged when the span lies inside it", () => {
    expect(widen([5, 10], [6, 8])).toEqual([5, 10]);
  });
});

describe("median", () => {
  it("is null for no values", () => {
    expect(median([])).toBeNull();
  });

  it("is the one value of a single-value list", () => {
    expect(median([7])).toBe(7);
  });

  it("takes the middle value of an odd count, whatever the order", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("takes the mean of the middle two of an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not reorder the list it is given", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
