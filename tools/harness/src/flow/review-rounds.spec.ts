import { beforeEach, describe, expect, it, vi } from "vitest";
import { verdictsOf } from "./review-heads.js";
import { reviewRoundsIn } from "./review-rounds.js";
import {
  HAIKU,
  linkWriters,
  merged,
  resetReadings,
  sendBack,
  SONNET,
  SPAN,
  TIERS,
  verdict,
} from "./review-rounds-support.js";

vi.mock("./github-waits.js");
vi.mock("./review-heads.js");
vi.mock("./scope.js");
vi.mock("./writer-join.js");
vi.mock("./writer-tier-figures.js");

beforeEach(resetReadings);

describe("failed review rounds: a send-back, or a verdict with a violation, for a head", () => {
  it("counts a failing verdict with no send to the writer as a failed review round and not as rework", () => {
    linkWriters([[100, "h-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([verdict(100, "aaaaaaa", 2)]);

    const { tiers } = reviewRoundsIn([merged(100)], SPAN, TIERS);

    expect(tiers[HAIKU]?.failedReviewRounds).toBe(1);
    expect(tiers[HAIKU]?.rework).toBe(0);
    expect(tiers[SONNET]?.failedReviewRounds).toBe(0);
  });

  it("counts a send-back as a failed review round on the tier its pull request's writer joins to", () => {
    linkWriters([
      [100, "h-writer"],
      [200, "s-writer"],
    ]);
    const events = [
      sendBack(100, "scope @aaaaaaa"),
      sendBack(200, "scope @bbbbbbb"),
      sendBack(200, "failed-check @ccccccc"),
    ];

    const { tiers } = reviewRoundsIn(events, SPAN, TIERS);

    expect(tiers[HAIKU]?.failedReviewRounds).toBe(1);
    expect(tiers[SONNET]?.failedReviewRounds).toBe(2);
  });

  it("counts a send-back and a failing verdict on the same head as one round, and on two heads as two", () => {
    linkWriters([[100, "h-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([
      verdict(100, "aaaaaaa", 1),
      verdict(100, "bbbbbbb", 3),
    ]);
    const events = [sendBack(100, "scope @aaaaaaa")];

    const { tiers } = reviewRoundsIn(events, SPAN, TIERS);

    expect(tiers[HAIKU]?.failedReviewRounds).toBe(2);
  });

  it("counts a head once however many send-backs name it", () => {
    linkWriters([[100, "h-writer"]]);
    const events = [
      sendBack(100, "scope @aaaaaaa", 100),
      sendBack(100, "failed-check @aaaaaaa", 200),
    ];

    const { tiers } = reviewRoundsIn(events, SPAN, TIERS);

    expect(tiers[HAIKU]?.failedReviewRounds).toBe(1);
  });

  it("does not count a clean verdict or a verdict whose count was never recorded", () => {
    linkWriters([[100, "h-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([
      verdict(100, "aaaaaaa", 0),
      verdict(100, "bbbbbbb", undefined),
    ]);

    const { tiers } = reviewRoundsIn([], SPAN, TIERS);

    expect(tiers[HAIKU]?.failedReviewRounds).toBe(0);
  });

  it("counts only the rounds recorded inside the span", () => {
    linkWriters([[100, "h-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([
      verdict(100, "aaaaaaa", 1, 1000),
      verdict(100, "bbbbbbb", 1, 999),
    ]);
    const events = [sendBack(100, "scope @ccccccc", 1000)];

    const { tiers } = reviewRoundsIn(events, SPAN, TIERS);

    expect(tiers[HAIKU]?.failedReviewRounds).toBe(1);
  });
});

describe("failed review rounds of a change with no writer tier", () => {
  it("puts a round on a pull request with no writer link in the unlinked row and in no tier", () => {
    linkWriters([[100, "h-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([verdict(300, "aaaaaaa", 1)]);
    const events = [sendBack(400, "scope @bbbbbbb")];

    const { tiers, unlinked } = reviewRoundsIn(events, SPAN, TIERS);

    expect(unlinked.failedReviewRounds).toBe(2);
    expect(tiers[HAIKU]?.failedReviewRounds).toBe(0);
    expect(tiers[SONNET]?.failedReviewRounds).toBe(0);
  });

  it("counts a link to a session with no priced launch as unlinked, never as a guessed tier", () => {
    linkWriters([[100, "unknown-writer"]]);
    vi.mocked(verdictsOf).mockReturnValue([verdict(100, "aaaaaaa", 1)]);

    const { tiers, unlinked } = reviewRoundsIn([], SPAN, TIERS);

    expect(unlinked.failedReviewRounds).toBe(1);
    expect(tiers[HAIKU]?.failedReviewRounds).toBe(0);
  });

  it("counts each send-back with no pull request number or no head as its own round", () => {
    linkWriters([[100, "h-writer"]]);
    const events = [
      sendBack(undefined, "scope"),
      sendBack(undefined, "scope"),
      sendBack(100, "scope"),
      sendBack(100, "scope"),
    ];

    const { tiers, unlinked } = reviewRoundsIn(events, SPAN, TIERS);

    expect(unlinked.failedReviewRounds).toBe(2);
    expect(tiers[HAIKU]?.failedReviewRounds).toBe(2);
  });
});
