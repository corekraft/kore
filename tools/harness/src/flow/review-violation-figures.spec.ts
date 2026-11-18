import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { breakEvenIn, type BreakEven } from "./break-even.js";
import { splitFiguresAt } from "./date-split.js";
import { reviewViolationFiguresIn } from "./review-violation-figures.js";
import type { Span } from "./scope.js";
import {
  violationsByRuleIn,
  type ViolationsByRule,
} from "./violation-rules.js";
import { MODEL_PRICES } from "./writer-prices.js";

vi.mock("./break-even.js");
vi.mock("./date-split.js");
vi.mock("./violation-rules.js");

const SPAN: Span = [0, 1000];
const BEFORE: Span = [0, 500];
const AFTER: Span = [500, 1000];
const CUT = new Date("2026-11-16T00:00:00Z");
const EVENTS: LedgerEvent[] = [];
const MINIMUM = 5;

const violations = (failedVerdicts: number): ViolationsByRule => ({
  tiers: {},
  unlinked: { failedVerdicts, unlabelled: 0, citations: 0, rules: [] },
});
const breakEven = (merged: number): BreakEven => ({
  status: "insufficient merged changes",
  needed: MINIMUM,
  haiku: { tier: "h", mergedChanges: merged },
  sonnet: { tier: "s", mergedChanges: merged },
});

/** The marker each span reads as: 1 before the cut, 2 after it, 3 for the whole window. */
const countOf = (side: Span) =>
  new Map([
    [BEFORE, 1],
    [AFTER, 2],
  ]).get(side) ?? 3;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(violationsByRuleIn).mockImplementation((_events, side) =>
    violations(countOf(side)),
  );
  vi.mocked(breakEvenIn).mockImplementation((_events, side) =>
    breakEven(countOf(side)),
  );
  vi.mocked(splitFiguresAt).mockImplementation((_span, _at, read) => ({
    at: "2026-11-16T00:00:00.000Z",
    before: read(BEFORE),
    after: read(AFTER),
  }));
});

describe("reviewViolationFiguresIn: the violations by rule and the break-even over the window and its split (#1051)", () => {
  it("reads the violations over the priced tiers and the break-even against the minimum, with no split keys without a date", () => {
    expect(reviewViolationFiguresIn(EVENTS, SPAN, undefined, MINIMUM)).toEqual({
      violationsByRule: violations(3),
      breakEven: breakEven(3),
    });
    expect(violationsByRuleIn).toHaveBeenCalledWith(
      EVENTS,
      SPAN,
      Object.keys(MODEL_PRICES),
    );
    expect(breakEvenIn).toHaveBeenCalledWith(EVENTS, SPAN, MINIMUM);
    expect(splitFiguresAt).not.toHaveBeenCalled();
  });

  it("adds each figure's reading on the two sides of the split date under its own Split key", () => {
    const figures = reviewViolationFiguresIn(EVENTS, SPAN, CUT, MINIMUM);

    expect(figures.violationsByRuleSplit).toEqual({
      at: "2026-11-16T00:00:00.000Z",
      before: violations(1),
      after: violations(2),
    });
    expect(figures.breakEvenSplit).toEqual({
      at: "2026-11-16T00:00:00.000Z",
      before: breakEven(1),
      after: breakEven(2),
    });
    expect(splitFiguresAt).toHaveBeenCalledWith(
      SPAN,
      CUT,
      expect.any(Function),
    );
  });
});
