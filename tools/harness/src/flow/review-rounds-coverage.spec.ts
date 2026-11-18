import { beforeEach, describe, expect, it, vi } from "vitest";
import { headNamings, isReviewedAtHead, verdictsOf } from "./review-heads.js";
import { reviewRoundsIn } from "./review-rounds.js";
import {
  HAIKU,
  linkWriters,
  merged,
  resetReadings,
  reviewed,
  sendBack,
  SONNET,
  SPAN,
  TIERS,
  verdict,
} from "./review-rounds-support.js";
import { reworkSendsIn } from "./writer-tier-figures.js";

vi.mock("./github-waits.js");
vi.mock("./review-heads.js");
vi.mock("./scope.js");
vi.mock("./writer-join.js");
vi.mock("./writer-tier-figures.js");

beforeEach(resetReadings);

describe("failed review rounds sit beside rework, under their own name", () => {
  it("carries each tier's rework from the rework reading, with its rate over the merged changes", () => {
    linkWriters([
      [100, "h-writer"],
      [101, "h-writer"],
      [102, "h-writer"],
    ]);
    vi.mocked(reworkSendsIn).mockReturnValue(new Map([[HAIKU, 2]]));
    const events = [merged(100), merged(101), merged(102)];

    const { tiers } = reviewRoundsIn(events, SPAN, TIERS);

    expect(tiers[HAIKU]).toMatchObject({
      mergedChanges: 3,
      rework: 2,
      reworkPerMergedChange: 0.6667,
    });
    expect(tiers[SONNET]).toMatchObject({
      mergedChanges: 0,
      rework: 0,
      reworkPerMergedChange: null,
    });
    expect(reworkSendsIn).toHaveBeenCalledWith(events, SPAN);
  });

  it("has no rework in the unlinked row, since a send to a pane with no writer tier is not read", () => {
    const { unlinked } = reviewRoundsIn([merged(300)], SPAN, TIERS);

    expect(Object.keys(unlinked)).toEqual([
      "mergedChanges",
      "failedReviewRounds",
      "reviewedChanges",
      "reviewCoverage",
    ]);
  });

  it("reads the rate of failed review rounds over the merged changes, with both counts beside it", () => {
    linkWriters([
      [100, "h-writer"],
      [101, "h-writer"],
      [102, "h-writer"],
    ]);
    const events = [
      merged(100),
      merged(101),
      merged(102),
      sendBack(100, "scope @aaaaaaa"),
    ];

    const { tiers } = reviewRoundsIn(events, SPAN, TIERS);

    expect(tiers[HAIKU]).toMatchObject({
      mergedChanges: 3,
      failedReviewRounds: 1,
      failedReviewRoundsPerMergedChange: 0.3333,
    });
  });
});

describe("review coverage: the merged changes with a verdict for their head", () => {
  it("counts reviewed changes per tier with the merged changes the rate is read over", () => {
    linkWriters([
      [100, "h-writer"],
      [101, "h-writer"],
      [102, "h-writer"],
      [103, "h-writer"],
      [200, "s-writer"],
    ]);
    reviewed([100, 101, 200]);
    const events = [
      merged(100),
      merged(101),
      merged(102),
      merged(103),
      merged(200),
    ];

    const { tiers } = reviewRoundsIn(events, SPAN, TIERS);

    expect(tiers[HAIKU]).toMatchObject({
      mergedChanges: 4,
      reviewedChanges: 2,
      reviewCoverage: 0.5,
    });
    expect(tiers[SONNET]).toMatchObject({
      mergedChanges: 1,
      reviewedChanges: 1,
      reviewCoverage: 1,
    });
  });

  it("asks once per change, with its number and merge time, whether a verdict names its head", () => {
    linkWriters([[100, "h-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([verdict(100, "aaaaaaa", 0)]);
    vi.mocked(headNamings).mockReturnValue([
      { number: 100, head: "aaaaaaa", at: 100 },
    ]);
    reviewed([100]);

    reviewRoundsIn([merged(100, 700)], SPAN, TIERS);

    expect(isReviewedAtHead).toHaveBeenCalledTimes(1);
    expect(isReviewedAtHead).toHaveBeenCalledWith(
      100,
      700,
      [verdict(100, "aaaaaaa", 0)],
      [{ number: 100, head: "aaaaaaa", at: 100 }],
    );
  });
});

describe("review coverage: the rows with no merged change, outside the span or with no tier", () => {
  it("reads no rate, never zero, for a tier with no merged change", () => {
    const { tiers, unlinked } = reviewRoundsIn([], SPAN, TIERS);

    expect(tiers[HAIKU]).toEqual({
      mergedChanges: 0,
      failedReviewRounds: 0,
      failedReviewRoundsPerMergedChange: null,
      rework: 0,
      reworkPerMergedChange: null,
      reviewedChanges: 0,
      reviewCoverage: null,
    });
    expect(unlinked).toEqual({
      mergedChanges: 0,
      failedReviewRounds: 0,
      reviewedChanges: 0,
      reviewCoverage: null,
    });
  });

  it("counts a change merged outside the span in no row", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers, unlinked } = reviewRoundsIn(
      [merged(100, 1000), merged(100, -1)],
      SPAN,
      TIERS,
    );

    expect(tiers[HAIKU]?.mergedChanges).toBe(0);
    expect(unlinked.mergedChanges).toBe(0);
  });

  it("puts a merged change with no writer link in the unlinked row with its own coverage, and gives it no tier", () => {
    linkWriters([[100, "h-writer"]]);
    reviewed([300]);

    const { tiers, unlinked } = reviewRoundsIn(
      [merged(300), merged(301)],
      SPAN,
      TIERS,
    );

    expect(unlinked).toEqual({
      mergedChanges: 2,
      failedReviewRounds: 0,
      reviewedChanges: 1,
      reviewCoverage: 0.5,
    });
    expect(tiers[HAIKU]?.mergedChanges).toBe(0);
    expect(tiers[SONNET]?.mergedChanges).toBe(0);
  });
});

describe("what the figures hold", () => {
  it("carries counts and rates only, never a label or any text from a verdict or a send-back", () => {
    linkWriters([[100, "h-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([verdict(100, "aaaaaaa", 1)]);

    const result = reviewRoundsIn(
      [merged(100), sendBack(100, "secret reason text @bbbbbbb")],
      SPAN,
      TIERS,
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("aaaaaaa");
    expect(json).not.toContain("bbbbbbb");
  });
});
