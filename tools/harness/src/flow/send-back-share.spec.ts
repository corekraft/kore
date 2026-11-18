import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendBackCategory } from "../ledger/index.js";
import { splitSpanAt } from "./date-split.js";
import type { Span } from "./scope.js";
import {
  CATEGORY_REQUIRED_FROM,
  legacySpan,
  otherShareOf,
} from "./send-back-share.js";

vi.mock("./date-split.js");

const ZERO = {
  declaration: 0,
  "pattern-mismatch": 0,
  "failed-check": 0,
  conflict: 0,
  "missing-proof": 0,
  "rule-break": 0,
  scope: 0,
  "wrong-statement": 0,
  other: 0,
} satisfies Record<SendBackCategory, number>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CATEGORY_REQUIRED_FROM: the day the judge's send-back command started requiring a category", () => {
  it("is 2026-11-16 UTC (#884)", () => {
    expect(CATEGORY_REQUIRED_FROM.toISOString()).toBe(
      "2026-11-16T00:00:00.000Z",
    );
  });
});

describe("legacySpan: the part of a window before the category requirement", () => {
  it("is the before side of the window cut at the requirement's date (#1047)", () => {
    const window: Span = [0, 1000];
    const before: Span = [0, 400];
    vi.mocked(splitSpanAt).mockReturnValue({ before, after: [400, 1000] });

    expect(legacySpan(window)).toBe(before);
    expect(splitSpanAt).toHaveBeenCalledWith(window, CATEGORY_REQUIRED_FROM);
  });
});

describe("otherShareOf: other over the categorised send-backs, read only from a minimum sample", () => {
  it("reads insufficient, never over, below the minimum even when every categorised send-back is other", () => {
    expect(otherShareOf({ ...ZERO, other: 19 }, 20, 0.1)).toEqual({
      categorised: 19,
      otherShare: 1,
      minCategorised: 20,
      otherReading: "insufficient",
      otherOverThreshold: false,
    });
  });

  it("reads insufficient, never within, below the minimum when no send-back is other", () => {
    expect(otherShareOf({ ...ZERO, scope: 3 }, 20, 0.1)).toEqual({
      categorised: 3,
      otherShare: 0,
      minCategorised: 20,
      otherReading: "insufficient",
      otherOverThreshold: false,
    });
  });

  it("reads over when the categorised count is at the minimum and the share is past the threshold", () => {
    expect(otherShareOf({ ...ZERO, scope: 17, other: 3 }, 20, 0.1)).toEqual({
      categorised: 20,
      otherShare: 0.15,
      minCategorised: 20,
      otherReading: "over",
      otherOverThreshold: true,
    });
  });

  it("reads within when the share is exactly the threshold", () => {
    expect(otherShareOf({ ...ZERO, scope: 18, other: 2 }, 20, 0.1)).toEqual({
      categorised: 20,
      otherShare: 0.1,
      minCategorised: 20,
      otherReading: "within",
      otherOverThreshold: false,
    });
  });

  it("has no share and reads insufficient with no categorised send-back", () => {
    expect(otherShareOf(ZERO, 20, 0.1)).toEqual({
      categorised: 0,
      otherShare: null,
      minCategorised: 20,
      otherReading: "insufficient",
      otherOverThreshold: false,
    });
  });
});
