import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent, SendBackCategory } from "../ledger/index.js";
import { closedIdeas } from "./cost.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import {
  categoryReport,
  OTHER_SHARE_THRESHOLD,
  sendBackCategories,
  sendBacksInRange,
} from "./send-back-categories.js";
import {
  legacySpan,
  otherShareOf,
  type OtherShare,
} from "./send-back-share.js";

vi.mock("./cost.js");
vi.mock("./github-waits.js");
vi.mock("./scope.js");
vi.mock("./send-back-share.js");

const WINDOW: Span = [0, 1000];
/** The legacy part of the window: send-backs before 5 ms were recorded before the requirement. */
const LEGACY_END = 5;
const MINIMUM = 7;
/** A share the mocked helper returns, told from any real reading by its values. */
const SHARE: OtherShare = {
  categorised: 41,
  otherShare: 0.5,
  minCategorised: MINIMUM,
  otherReading: "over",
  otherOverThreshold: true,
};
const HEAD_A = "abcdef1234567890abcdef1234567890abcdef12";
const HEAD_B = "1234567abcdef1234567abcdef1234567abcdef1";

let seq = 0;
/** A send-back on PR 42 at the given head; no category unless one is given. */
function sendBack(
  head: string,
  category?: SendBackCategory,
  ms = 10,
): LedgerEvent {
  seq += 1;
  return {
    schema: 1,
    id: `e${seq}`,
    source: "github",
    kind: "send-back" as Kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    number: 42,
    label: `too slow @${head.slice(0, 7)}`,
    ...(category === undefined ? {} : { category }),
  };
}

const NONE = {
  declaration: 0,
  "pattern-mismatch": 0,
  "failed-check": 0,
  conflict: 0,
  "missing-proof": 0,
  "rule-break": 0,
  scope: 0,
  "wrong-statement": 0,
  other: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Date.parse(e.occurredAt));
  vi.mocked(inWindow).mockImplementation((w, t) => t >= w[0] && t < w[1]);
  vi.mocked(closedIdeas).mockReturnValue([]);
  vi.mocked(legacySpan).mockImplementation((w) => [w[0], LEGACY_END]);
  vi.mocked(otherShareOf).mockReturnValue(SHARE);
});

describe("sendBackCategories: counting", () => {
  it("names every category at zero, with nothing legacy or uncategorised, for a ledger with no send-backs", () => {
    expect(sendBackCategories([], WINDOW, MINIMUM)).toEqual({
      byCategory: NONE,
      legacy: 0,
      uncategorised: 0,
      otherThreshold: OTHER_SHARE_THRESHOLD,
      ...SHARE,
    });
    expect(otherShareOf).toHaveBeenCalledWith(
      NONE,
      MINIMUM,
      OTHER_SHARE_THRESHOLD,
    );
  });

  it("counts a category once per PR head, so a rerun at one head counts once", () => {
    const events = [
      sendBack(HEAD_A, "failed-check", 10),
      sendBack(HEAD_A, "failed-check", 20),
    ];
    expect(sendBackCategories(events, WINDOW, MINIMUM).byCategory).toEqual({
      ...NONE,
      "failed-check": 1,
    });
  });

  it("counts each head apart, and each category apart on the same head", () => {
    const events = [
      sendBack(HEAD_A, "failed-check", 10),
      sendBack(HEAD_A, "conflict", 20),
      sendBack(HEAD_B, "failed-check", 30),
    ];
    expect(sendBackCategories(events, WINDOW, MINIMUM).byCategory).toEqual({
      ...NONE,
      "failed-check": 2,
      conflict: 1,
    });
  });

  it("counts a wrong-statement send-back in its own category, never in other", () => {
    const counts = sendBackCategories(
      [sendBack(HEAD_A, "wrong-statement", 10)],
      WINDOW,
      MINIMUM,
    );
    expect(counts.byCategory).toEqual({ ...NONE, "wrong-statement": 1 });
  });
});

describe("sendBackCategories: legacy, uncategorised and the share of other", () => {
  it("counts a send-back recorded before the category requirement as legacy, never as uncategorised or other", () => {
    const counts = sendBackCategories(
      [sendBack(HEAD_A, undefined, 2)],
      WINDOW,
      MINIMUM,
    );
    expect(counts.legacy).toBe(1);
    expect(counts.uncategorised).toBe(0);
    expect(counts.byCategory).toEqual(NONE);
    expect(otherShareOf).toHaveBeenCalledWith(
      NONE,
      MINIMUM,
      OTHER_SHARE_THRESHOLD,
    );
  });

  it("counts a send-back with no category from after the requirement as uncategorised, never as legacy or other", () => {
    const counts = sendBackCategories(
      [sendBack(HEAD_A, undefined, 10)],
      WINDOW,
      MINIMUM,
    );
    expect(counts.uncategorised).toBe(1);
    expect(counts.legacy).toBe(0);
    expect(counts.byCategory).toEqual(NONE);
  });

  it("counts two legacy and three categorised send-backs exactly, the share read from the three alone", () => {
    const events = [
      sendBack("1111111aaaa", undefined, 1),
      sendBack("2222222bbbb", undefined, 3),
      sendBack("3333333cccc", "other", 10),
      sendBack("4444444dddd", "failed-check", 20),
      sendBack("5555555eeee", "failed-check", 30),
    ];
    const counts = sendBackCategories(events, WINDOW, MINIMUM);
    expect(counts).toEqual({
      byCategory: { ...NONE, other: 1, "failed-check": 2 },
      legacy: 2,
      uncategorised: 0,
      otherThreshold: OTHER_SHARE_THRESHOLD,
      ...SHARE,
    });
    // The legacy pair is not in the byCategory counts the share is read from.
    expect(otherShareOf).toHaveBeenCalledWith(
      { ...NONE, other: 1, "failed-check": 2 },
      MINIMUM,
      OTHER_SHARE_THRESHOLD,
    );
  });
});

describe("sendBackCategories: legacy send-backs and the share helper", () => {
  it("counts a legacy send-back once per PR head, like any other", () => {
    const counts = sendBackCategories(
      [sendBack(HEAD_A, undefined, 1), sendBack(HEAD_A, undefined, 2)],
      WINDOW,
      MINIMUM,
    );
    expect(counts.legacy).toBe(1);
  });

  it("takes the share, its reading and the minimum from the share helper, with the threshold beside them", () => {
    const counts = sendBackCategories(
      [sendBack(HEAD_A, "other", 10)],
      WINDOW,
      MINIMUM,
    );
    expect(counts).toMatchObject({
      categorised: 41,
      otherShare: 0.5,
      minCategorised: MINIMUM,
      otherReading: "over",
      otherOverThreshold: true,
      otherThreshold: OTHER_SHARE_THRESHOLD,
    });
  });

  it("counts only send-backs inside the window, and no other kind of event", () => {
    const events = [
      sendBack(HEAD_A, "conflict", 5000),
      sendBack(HEAD_B, "conflict", 10),
      {
        ...sendBack(HEAD_A, "scope", 20),
        kind: "escalation" as Kind,
        label: "relaunched",
      },
    ];
    expect(sendBackCategories(events, WINDOW, MINIMUM).byCategory).toEqual({
      ...NONE,
      conflict: 1,
    });
  });
});

describe("categoryReport: per PR head and per merged change", () => {
  it("counts the send-backs of closed ideas as the merged change's, and every send-back per PR head", () => {
    const merged = sendBack(HEAD_A, "conflict", 10);
    const abandoned = sendBack(HEAD_B, "failed-check", 20);
    vi.mocked(closedIdeas).mockReturnValue([
      { idea: "0042", at: 500, own: [merged] },
    ]);

    const report = categoryReport(
      [merged, abandoned],
      new Map(),
      WINDOW,
      MINIMUM,
    );
    expect(report.perPrHead.byCategory).toEqual({
      ...NONE,
      conflict: 1,
      "failed-check": 1,
    });
    expect(report.perMergedChange.byCategory).toEqual({
      ...NONE,
      conflict: 1,
    });
    // Both are read against the minimum the report was given.
    expect(report.perPrHead.minCategorised).toBe(MINIMUM);
    expect(otherShareOf).toHaveBeenCalledTimes(2);
  });
});

describe("sendBacksInRange: every send-back in the window, once per PR head (#830)", () => {
  it("counts a send-back whatever its category, and a rerun at one head once", () => {
    expect(
      sendBacksInRange(
        [
          sendBack(HEAD_A, "scope", 10),
          sendBack(HEAD_A, "scope", 20),
          sendBack(HEAD_B, undefined, 30),
        ],
        WINDOW,
      ),
    ).toBe(2);
  });

  it("counts a legacy send-back with the rest, so a per-merged figure keeps what it was, and leaves out one at the window's end", () => {
    expect(
      sendBacksInRange(
        [
          sendBack(HEAD_A, undefined, 2),
          sendBack(HEAD_B, undefined, 10),
          sendBack("9999999aaaa", "conflict", 20),
          sendBack("8888888bbbb", "conflict", 1000),
        ],
        WINDOW,
      ),
    ).toBe(3);
  });
});
