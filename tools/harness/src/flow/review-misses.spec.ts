import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent, SendBackCategory } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { reviewMisses } from "./review-misses.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const DAY = 86_400_000;
/** The report window is the eleventh day; the trailing day before it is the tenth. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const ONE_DAY = 1;
const ASOF = new Date(20 * DAY);

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(ms: number, kind: Kind): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
  } satisfies LedgerEvent;
}

/** A review.run on a PR with its label; a findings count only when the verdict was recorded. */
function review(
  ms: number,
  number: number,
  label: string,
  findings?: number,
): LedgerEvent {
  return {
    ...event(ms, "review.run"),
    number,
    label,
    ...(findings === undefined ? {} : { findings }),
  };
}

/** A judge send-back on a PR, with a category when it has one. */
function sendBack(
  ms: number,
  number: number,
  category?: SendBackCategory,
): LedgerEvent {
  return {
    ...event(ms, "send-back"),
    number,
    label: "too slow",
    ...(category === undefined ? {} : { category }),
  };
}

const measure = (events: LedgerEvent[]) =>
  reviewMisses(events, WINDOW, { trailingDays: ONE_DAY, asOf: ASOF });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
});

describe("review misses: what a review is", () => {
  it("counts a PR head once, whichever of its posted or unchanged verdicts came first", () => {
    const r = measure([
      review(10.1 * DAY, 42, "posted:1111111", 0),
      review(10.2 * DAY, 42, "unchanged:1111111", 0),
      review(10.3 * DAY, 42, "posted:2222222", 1),
    ]);
    expect(r.reviews).toBe(2);
    expect(r.foundViolation.count).toBe(1);
  });

  it("leaves out failed and rerun reviews, which post no verdict", () => {
    const r = measure([
      review(10.1 * DAY, 42, "failed:no verdict"),
      review(10.2 * DAY, 42, "rerun:1111111"),
    ]);
    expect(r).toMatchObject({ reviews: 0, unrecorded: 0 });
  });

  it("counts a review that recorded no findings count as unrecorded, out of every figure", () => {
    const r = measure([review(10.1 * DAY, 42, "posted:1111111")]);
    expect(r).toMatchObject({
      reviews: 0,
      unrecorded: 1,
      passedRuleBreak: { count: 0, ratio: null },
      foundViolation: { count: 0, share: null },
    });
  });

  it("gives null, never zero, for a window with no reviews", () => {
    const r = measure([]);
    expect(r).toMatchObject({
      reviews: 0,
      passedRuleBreak: { ratio: null, trailingAverage: null },
      foundViolation: { share: null, trailingAverage: null },
    });
  });
});

describe("review misses: the passed-then-rule-break ratio", () => {
  it("counts a clean review as passed-then-sent-back only when a rule-break send-back on its PR comes later", () => {
    const r = measure([
      review(10.1 * DAY, 1, "posted:1111111", 0),
      sendBack(10.5 * DAY, 1, "rule-break"),
      review(10.1 * DAY, 2, "posted:1111111", 0),
      sendBack(10.5 * DAY, 2, "failed-check"),
      review(10.1 * DAY, 3, "posted:1111111", 0),
      sendBack(10.05 * DAY, 3, "rule-break"),
      review(10.1 * DAY, 4, "posted:1111111", 0),
      sendBack(10.5 * DAY, 5, "rule-break"),
    ]);
    expect(r.passedRuleBreak).toMatchObject({ count: 1, ratio: 0.25 });
  });

  it("never counts a review that found violations as passed, even when a rule break followed", () => {
    const r = measure([
      review(10.1 * DAY, 1, "posted:1111111", 2),
      sendBack(10.5 * DAY, 1, "rule-break"),
    ]);
    expect(r.passedRuleBreak).toMatchObject({ count: 0, ratio: 0 });
  });

  it("gives the ratio over every review, not only the passed ones", () => {
    const r = measure([
      review(10.1 * DAY, 1, "posted:1111111", 0),
      sendBack(10.5 * DAY, 1, "rule-break"),
      review(10.1 * DAY, 2, "posted:1111111", 3),
      review(10.1 * DAY, 3, "posted:1111111", 0),
      review(10.1 * DAY, 4, "posted:1111111", 1),
    ]);
    expect(r.reviews).toBe(4);
    expect(r.passedRuleBreak.ratio).toBe(0.25);
  });

  it("gives no weight to a rule-break send-back at or after as-of", () => {
    const r = measure([
      review(10.1 * DAY, 1, "posted:1111111", 0),
      sendBack(21 * DAY, 1, "rule-break"),
    ]);
    expect(r.passedRuleBreak.count).toBe(0);
  });
});

describe("review misses: the found-violation share", () => {
  it("gives the share of reviews that found at least one violation", () => {
    const r = measure([
      review(10.1 * DAY, 1, "posted:1111111", 0),
      review(10.1 * DAY, 2, "posted:1111111", 2),
      review(10.1 * DAY, 3, "posted:1111111", 1),
      review(10.1 * DAY, 4, "posted:1111111", 0),
    ]);
    expect(r.foundViolation).toMatchObject({ count: 2, share: 0.5 });
  });
});

describe("review misses: the trailing average and the first window", () => {
  it("averages seven days before the window when no trailing days are given", () => {
    const r = reviewMisses(
      [
        review(3.5 * DAY, 1, "posted:1111111", 0),
        sendBack(3.8 * DAY, 1, "rule-break"),
      ],
      WINDOW,
      { asOf: ASOF },
    );
    expect(r).toMatchObject({ trailingDays: 7 });
    expect(r.passedRuleBreak.trailingAverage).toBe(1);
  });

  it("averages the days before the window, never the window itself", () => {
    const r = measure([
      review(9.5 * DAY, 1, "posted:1111111", 0),
      sendBack(9.8 * DAY, 1, "rule-break"),
      review(10.1 * DAY, 2, "posted:1111111", 0),
    ]);
    expect(r.passedRuleBreak).toMatchObject({
      ratio: 0,
      trailingAverage: 1,
      worsened: false,
    });
  });

  it("flags the ratio as worsened when the window's figure is above the trailing average", () => {
    const r = measure([
      review(9.1 * DAY, 1, "posted:1111111", 0),
      review(9.2 * DAY, 2, "posted:1111111", 0),
      review(10.1 * DAY, 3, "posted:1111111", 0),
      sendBack(10.5 * DAY, 3, "rule-break"),
    ]);
    expect(r.passedRuleBreak).toMatchObject({
      ratio: 1,
      trailingAverage: 0,
      worsened: true,
    });
  });

  it("gives the found share's trailing average over the same days", () => {
    const r = measure([
      review(9.1 * DAY, 1, "posted:1111111", 1),
      review(9.2 * DAY, 2, "posted:1111111", 0),
      review(10.1 * DAY, 3, "posted:1111111", 0),
    ]);
    expect(r.foundViolation).toMatchObject({ share: 0, trailingAverage: 0.5 });
  });

  it("gives no trailing average on the first window, a baseline that is never worsened", () => {
    const r = measure([
      review(10.1 * DAY, 1, "posted:1111111", 0),
      sendBack(10.5 * DAY, 1, "rule-break"),
    ]);
    expect(r.passedRuleBreak).toMatchObject({
      ratio: 1,
      trailingAverage: null,
      worsened: false,
    });
    expect(r.foundViolation.trailingAverage).toBeNull();
  });
});
