import { beforeEach, describe, expect, it, vi } from "vitest";
import { time } from "./github-waits.js";
import { reviewMisses } from "./review-misses.js";
import { buildReport } from "./report.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { newLife } from "./toil.js";
import {
  fakeLife,
  fakeTally,
  ev,
  ASOF,
  SCOPE,
  WINDOW,
  cover,
  run,
} from "./report-support.js";

vi.mock("./github-waits.js");
vi.mock("./review-misses.js");
vi.mock("./scope.js");
vi.mock("./select.js");
vi.mock("./tally.js");
vi.mock("./toil.js");

const FIGURE = {
  trailingDays: 7,
  reviews: 2,
  unrecorded: 0,
  passedRuleBreak: {
    count: 1,
    ratio: 0.5,
    trailingAverage: null,
    worsened: false,
  },
  foundViolation: { count: 1, share: 0.5, trailingAverage: null },
  resample: { count: 1, found: 0, share: 0 },
};

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  vi.mocked(reviewMisses).mockReturnValue(FIGURE);
  cover(new Map());
});

describe("buildReport review misses (#851)", () => {
  it("reports passed reviews later sent back for a rule break, and reviews that found a violation, over every named event, the window as-of time", () => {
    fakeTally();
    const named = [ev(1, "review.run")];
    cover(new Map(), named);

    expect(run([]).reviewMisses).toBe(FIGURE);
    expect(reviewMisses).toHaveBeenCalledWith(named, WINDOW, { asOf: ASOF });
  });

  it("versions the report to 17 when the review figures join it, since a field changed", () => {
    fakeTally();
    const report = buildReport([], { asOf: ASOF, minCompletedIdeas: 1 });
    expect(report.version).toBe(23);
  });
});
