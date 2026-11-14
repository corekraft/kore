import { describe, expect, it } from "vitest";
import { totalsEdits } from "./totals.js";

const DATE = "2026-01-02";

// The totals line sits in the intro above the first class heading.
const INTRO = [
  "Every item sits in one class (as of 2026-11-09: 2 local, 1 managed",
  "cluster, 1 release pipeline).",
  "",
  "### Local",
  "- Step 1 (2): First item.",
];
const RANGE: [number, number] = [0, INTRO.length];

describe("totalsEdits", () => {
  it("decrements the local count and restamps the date for a Local entry", () => {
    expect(totalsEdits(INTRO, RANGE, "Local", DATE)).toEqual([
      {
        start: 0,
        end: 1,
        lines: [
          "Every item sits in one class (as of 2026-01-02: 1 local, 1 managed",
        ],
      },
    ]);
  });

  it("decrements the managed count across the wrapped line for a Managed cluster entry", () => {
    expect(totalsEdits(INTRO, RANGE, "Managed cluster", DATE)).toEqual([
      {
        start: 0,
        end: 1,
        lines: [
          "Every item sits in one class (as of 2026-01-02: 2 local, 0 managed",
        ],
      },
    ]);
  });

  it("decrements the release count on the wrapped second line", () => {
    expect(
      totalsEdits(INTRO, RANGE, "Release pipeline and settings", DATE),
    ).toEqual([
      {
        start: 0,
        end: 1,
        lines: [
          "Every item sits in one class (as of 2026-01-02: 2 local, 1 managed",
        ],
      },
      {
        start: 1,
        end: 2,
        lines: ["cluster, 0 release pipeline)."],
      },
    ]);
  });

  it("matches the class by the start of its name, ignoring case", () => {
    expect(totalsEdits(INTRO, RANGE, "LOCAL (offline)", DATE)).toEqual(
      totalsEdits(INTRO, RANGE, "Local", DATE),
    );
  });
});

describe("totalsEdits refusals and intro", () => {
  it("reports a class name it cannot recount, naming it", () => {
    const error = totalsEdits(INTRO, RANGE, "Elsewhere", DATE);
    expect(error).toContain('"Elsewhere"');
    expect(error).toContain("tick the item by hand");
  });

  it("reports a totals line in another form, which cannot be recounted", () => {
    const lines = ["Items (as of 2026-11-09: two local).", "", "### Local"];
    const error = totalsEdits(lines, [0, lines.length], "Local", DATE);
    expect(error).toContain("not in the form");
  });

  it("returns no edits when the intro has no totals line", () => {
    const lines = ["Plain intro.", "", "### Local"];
    expect(totalsEdits(lines, [0, lines.length], "Local", DATE)).toEqual([]);
  });

  it("reads only the intro, never a totals line inside a class", () => {
    const lines = [
      "as of 2026-11-09: 2 local, 1 managed cluster, 1 release pipeline",
      "",
      "### Local",
      "as of 2026-11-09: 9 local, 9 managed cluster, 9 release pipeline",
    ];
    expect(totalsEdits(lines, [0, lines.length], "Local", DATE)).toEqual([
      {
        start: 0,
        end: 1,
        lines: [
          "as of 2026-01-02: 1 local, 1 managed cluster, 1 release pipeline",
        ],
      },
    ]);
  });
});
