import { describe, expect, it } from "vitest";
import { tierDollarsIn, type WriterDollars } from "./writer-attribution.js";

/** A span's dollars: the changes as they were attributed, and the shared judge and orchestrating spend. */
const dollars = (
  changes: WriterDollars["changes"],
  shared = { judge: 0, orchestrate: 0 },
): WriterDollars => ({ changes, shared, unmergedWriterSessions: 0 });

const HAIKU = "claude-haiku-5-5";

describe("tier dollars: a tier's all-in cost per merged change", () => {
  it("divides the shared spend by every merged change, joined or not, and reads the median of the per-change totals", () => {
    const r = tierDollarsIn(
      dollars(
        [
          { number: 100, tier: HAIKU, writer: 11, reviewer: 4 },
          { number: 102, tier: HAIKU, writer: 1, reviewer: 0 },
          { number: 103, tier: HAIKU, writer: 3, reviewer: 0 },
          // Unjoinable: it takes its share of the shared spend but no tier's writer or reviewer.
          { number: 104, tier: undefined, writer: undefined, reviewer: 0 },
        ],
        { judge: 4, orchestrate: 2 },
      ),
      HAIKU,
    );

    // Shared spend 6 over four merged changes: 1 judge and 0.5 orchestrate for each (1.5 with both).
    // Writer mean 5, reviewer mean 4 over three: 1.3333. Totals 16.5, 2.5, 4.5: the median is 4.5.
    expect(r).toEqual({
      writer: 5,
      reviewer: 1.3333,
      judge: 1,
      orchestrate: 0.5,
      allIn: 7.8333,
      median: 4.5,
    });
  });

  it("reads a tier with no merged change joined to it as null, never as zero", () => {
    expect(
      tierDollarsIn(
        dollars([
          { number: 104, tier: undefined, writer: undefined, reviewer: 0 },
        ]),
        HAIKU,
      ),
    ).toBeNull();
  });
});
