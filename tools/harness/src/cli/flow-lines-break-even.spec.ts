import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BreakEven, ReviewRounds } from "../flow/index.js";
import {
  breakEvenLine,
  breakEvenReportLines,
} from "./flow-lines-break-even.js";
import { changes } from "./flow-lines-writer-cost.js";

vi.mock("./flow-lines-writer-cost.js");

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

const rounds = (reworkPerMergedChange: number | null): ReviewRounds => ({
  tiers: {
    [HAIKU]: {
      mergedChanges: 4,
      failedReviewRounds: 0,
      failedReviewRoundsPerMergedChange: null,
      rework: 2,
      reworkPerMergedChange,
      reviewedChanges: 0,
      reviewCoverage: null,
    },
  },
  unlinked: {
    mergedChanges: 0,
    failedReviewRounds: 0,
    reviewedChanges: 0,
    reviewCoverage: null,
  },
});

const FIGURES = {
  needed: 5,
  haiku: {
    tier: HAIKU,
    mergedChanges: 9,
    noRework: { changes: 6, median: 0.27 },
    oneRound: { changes: 2, median: 1.17 },
  },
  sonnet: { tier: SONNET, mergedChanges: 7, median: 0.93 },
};

const OK: BreakEven = {
  status: "ok",
  ...FIGURES,
  costPerReworkRound: 0.9,
  reworkRoundsPerMergedChange: 0.7333,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(changes).mockImplementation((n) => `${n} MC`);
});

describe("breakEvenLine: the break-even beside the rework rate", () => {
  it("prints the break-even, Haiku's rework rate and the three medians it uses, each with its count", () => {
    expect(breakEvenLine(OK, rounds(0.5))).toBe(
      "Haiku-Sonnet break-even: 0.7333 rework rounds per merged change at which claude-haiku-5-5's median all-in cost reaches claude-sonnet-5-5's; claude-haiku-5-5 rework 0.5 per merged change; medians: claude-haiku-5-5 with no rework $0.27 over 6 MC, claude-haiku-5-5 with one rework round $1.17 over 2 MC, claude-sonnet-5-5 $0.93 over 7 MC; one rework round adds $0.9",
    );
  });

  it("says the rework rate is not read when Haiku has no merged change to read it over", () => {
    expect(breakEvenLine(OK, rounds(null))).toContain(
      "claude-haiku-5-5 rework per merged change not read;",
    );
  });

  it("names a tier below the minimum as insufficient and prints no break-even and no median", () => {
    const line = breakEvenLine(
      {
        status: "insufficient merged changes",
        needed: 5,
        haiku: { tier: HAIKU, mergedChanges: 2 },
        sonnet: { tier: SONNET, mergedChanges: 7 },
      },
      rounds(0.5),
    );

    expect(line).toBe(
      "Haiku-Sonnet break-even not read: insufficient merged changes, claude-haiku-5-5 2 MC, claude-sonnet-5-5 7 MC, 5 needed in each tier; claude-haiku-5-5 rework 0.5 per merged change",
    );
  });

  it("names the unpriced models when the dollars cannot be read", () => {
    expect(
      breakEvenLine(
        { status: "insufficient prices", models: ["claude-x", "claude-y"] },
        rounds(0.5),
      ),
    ).toBe("Haiku-Sonnet break-even not read: no price for claude-x, claude-y");
  });

  it("gives the reason a break-even is not read and the medians that were, a missing median as no change", () => {
    const line = breakEvenLine(
      {
        status: "not read",
        reason: "no Haiku change with one rework round",
        ...FIGURES,
        haiku: { ...FIGURES.haiku, oneRound: { changes: 0, median: null } },
      },
      rounds(0.5),
    );

    expect(line).toBe(
      "Haiku-Sonnet break-even not read: no Haiku change with one rework round; claude-haiku-5-5 rework 0.5 per merged change; medians: claude-haiku-5-5 with no rework $0.27 over 6 MC, claude-haiku-5-5 with one rework round no change, claude-sonnet-5-5 $0.93 over 7 MC",
    );
  });
});

describe("breakEvenReportLines: the split date", () => {
  const SPLIT_OK: BreakEven = {
    status: "insufficient merged changes",
    needed: 5,
    haiku: { tier: HAIKU, mergedChanges: 1 },
    sonnet: { tier: SONNET, mergedChanges: 1 },
  };
  const SPLIT_LINE =
    "Haiku-Sonnet break-even not read: insufficient merged changes, claude-haiku-5-5 1 MC, claude-sonnet-5-5 1 MC, 5 needed in each tier; claude-haiku-5-5 rework 0.2 per merged change";

  it("prints one line when the report has no split", () => {
    expect(
      breakEvenReportLines({
        breakEven: SPLIT_OK,
        reviewRounds: rounds(0.2),
      }),
    ).toEqual([SPLIT_LINE]);
  });

  it("prints each side of the date under a header naming it, each read against that side's own rework rate", () => {
    const lines = breakEvenReportLines({
      breakEven: SPLIT_OK,
      reviewRounds: rounds(0.2),
      breakEvenSplit: {
        at: "2026-11-16T00:00:00.000Z",
        before: SPLIT_OK,
        after: SPLIT_OK,
      },
      reviewRoundsSplit: {
        at: "2026-11-16T00:00:00.000Z",
        before: rounds(0.6),
        after: rounds(0.1),
      },
    });

    expect(lines).toEqual([
      SPLIT_LINE,
      "Haiku-Sonnet break-even by writer tier, before 2026-11-16T00:00:00.000Z:",
      `  ${SPLIT_LINE.replace("rework 0.2", "rework 0.6")}`,
      "Haiku-Sonnet break-even by writer tier, on or after 2026-11-16T00:00:00.000Z:",
      `  ${SPLIT_LINE.replace("rework 0.2", "rework 0.1")}`,
    ]);
  });
});
