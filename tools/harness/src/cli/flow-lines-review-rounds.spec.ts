import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewRounds, TierReviewRounds } from "../flow/index.js";
import {
  reviewRoundLines,
  reviewRoundReportLines,
} from "./flow-lines-review-rounds.js";
import { changes } from "./flow-lines-writer-cost.js";

vi.mock("./flow-lines-writer-cost.js");

const tier = (fields: Partial<TierReviewRounds> = {}): TierReviewRounds => ({
  mergedChanges: 0,
  failedReviewRounds: 0,
  failedReviewRoundsPerMergedChange: null,
  rework: 0,
  reworkPerMergedChange: null,
  reviewedChanges: 0,
  reviewCoverage: null,
  ...fields,
});

const NO_UNLINKED: ReviewRounds["unlinked"] = {
  mergedChanges: 0,
  failedReviewRounds: 0,
  reviewedChanges: 0,
  reviewCoverage: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(changes).mockImplementation((n) => `${n} MC`);
});

describe("reviewRoundLines: failed review rounds beside rework, and review coverage, per writer tier", () => {
  it("prints each tier's failed review rounds, rework and coverage, each with the count it is read over", () => {
    const lines = reviewRoundLines({
      tiers: {
        "claude-haiku-5-5": tier({
          mergedChanges: 4,
          failedReviewRounds: 3,
          failedReviewRoundsPerMergedChange: 0.75,
          rework: 2,
          reworkPerMergedChange: 0.5,
          reviewedChanges: 3,
          reviewCoverage: 0.75,
        }),
      },
      unlinked: NO_UNLINKED,
    });

    expect(lines[0]).toBe(
      "Failed review rounds and review coverage, writer tier claude-haiku-5-5, 4 MC: failed review rounds 3 over 4 MC, 0.75 per merged change; rework 2 over 4 MC, 0.5 per merged change; review coverage 3 of 4 MC, 75%",
    );
  });

  it("reads a tier with no merged change as not read, never as zero", () => {
    const lines = reviewRoundLines({
      tiers: { "claude-sonnet-5-5": tier() },
      unlinked: NO_UNLINKED,
    });

    expect(lines[0]).toBe(
      "Failed review rounds and review coverage, writer tier claude-sonnet-5-5, 0 MC: failed review rounds 0 over 0 MC, per merged change not read; rework 0 over 0 MC, per merged change not read; review coverage 0 of 0 MC, not read",
    );
  });

  it("prints the unlinked row last, with its count of merged changes, no rework and no rate of failed rounds", () => {
    const lines = reviewRoundLines({
      tiers: { "claude-haiku-5-5": tier() },
      unlinked: {
        mergedChanges: 5,
        failedReviewRounds: 2,
        reviewedChanges: 1,
        reviewCoverage: 0.2,
      },
    });

    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "Failed review rounds and review coverage, unlinked row (5 MC with no writer tier): failed review rounds 2; rework not read, no writer tier; review coverage 1 of 5 MC, 20%",
    );
  });

  it("prints one line per tier in tier order", () => {
    const lines = reviewRoundLines({
      tiers: { b: tier(), a: tier() },
      unlinked: NO_UNLINKED,
    });

    expect(lines.map((l) => l.split(":")[0])).toEqual([
      "Failed review rounds and review coverage, writer tier b, 0 MC",
      "Failed review rounds and review coverage, writer tier a, 0 MC",
      "Failed review rounds and review coverage, unlinked row (0 MC with no writer tier)",
    ]);
  });
});

describe("reviewRoundReportLines: the lines with the split date's two sides (#1050)", () => {
  const rounds = (mergedChanges: number): ReviewRounds => ({
    tiers: {},
    unlinked: { ...NO_UNLINKED, mergedChanges },
  });
  const unlinkedLine = (n: number) =>
    `Failed review rounds and review coverage, unlinked row (${n} MC with no writer tier): failed review rounds 0; rework not read, no writer tier; review coverage 0 of ${n} MC, not read`;

  it("prints the lines alone, and no header, when the report has no split", () => {
    expect(
      reviewRoundReportLines({
        reviewRounds: rounds(1),
        reviewRoundsSplit: undefined,
      }),
    ).toEqual([unlinkedLine(1)]);
  });

  it("prints the lines, then each side under a header naming the date, indented", () => {
    const at = "2026-11-16T00:00:00.000Z";

    expect(
      reviewRoundReportLines({
        reviewRounds: rounds(3),
        reviewRoundsSplit: { at, before: rounds(1), after: rounds(2) },
      }),
    ).toEqual([
      unlinkedLine(3),
      `Failed review rounds and review coverage by writer tier, before ${at}:`,
      `  ${unlinkedLine(1)}`,
      `Failed review rounds and review coverage by writer tier, on or after ${at}:`,
      `  ${unlinkedLine(2)}`,
    ]);
  });
});
