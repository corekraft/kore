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

vi.mock("./cost.js");
vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: Span = [0, 1000];
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
});

describe("sendBackCategories: counting", () => {
  it("names every category at zero, and no share, for a ledger with no send-backs", () => {
    expect(sendBackCategories([], WINDOW)).toEqual({
      byCategory: NONE,
      uncategorised: 0,
      otherShare: null,
      otherThreshold: OTHER_SHARE_THRESHOLD,
      otherOverThreshold: false,
    });
  });

  it("counts a category once per PR head, so a rerun at one head counts once", () => {
    const events = [
      sendBack(HEAD_A, "failed-check", 10),
      sendBack(HEAD_A, "failed-check", 20),
    ];
    expect(sendBackCategories(events, WINDOW).byCategory).toEqual({
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
    expect(sendBackCategories(events, WINDOW).byCategory).toEqual({
      ...NONE,
      "failed-check": 2,
      conflict: 1,
    });
  });

  it("counts a wrong-statement send-back in its own category, never in other", () => {
    const counts = sendBackCategories(
      [sendBack(HEAD_A, "wrong-statement", 10)],
      WINDOW,
    );
    expect(counts.byCategory).toEqual({ ...NONE, "wrong-statement": 1 });
    expect(counts.otherShare).toBe(0);
  });
});

describe("sendBackCategories: uncategorised and the share of other", () => {
  it("counts a send-back recorded before categories existed as uncategorised, never as other", () => {
    const counts = sendBackCategories([sendBack(HEAD_A, undefined)], WINDOW);
    expect(counts.uncategorised).toBe(1);
    expect(counts.byCategory.other).toBe(0);
    expect(counts.otherShare).toBeNull();
  });

  it("gives the share of other over the categorised send-backs, and flags it past the threshold", () => {
    const events = [
      sendBack(HEAD_A, "other", 10),
      sendBack(HEAD_B, "failed-check", 20),
      sendBack(HEAD_A, "failed-check", 30),
      sendBack("9999999aaaa", undefined, 40),
    ];
    const counts = sendBackCategories(events, WINDOW);
    // Three categorised send-backs, one of them other: uncategorised is not in the share.
    expect(counts.otherShare).toBeCloseTo(1 / 3);
    expect(counts.uncategorised).toBe(1);
    expect(counts.otherOverThreshold).toBe(true);
  });

  it("does not flag other when its share is at or under the threshold", () => {
    const events = [
      sendBack(HEAD_A, "other", 10),
      ...[
        HEAD_B,
        "9999999aaaa",
        "1111111bbbb",
        "2222222cccc",
        "3333333dddd",
        "4444444eeee",
        "5555555ffff",
        "6666666aaaa",
        "7777777bbbb",
        "8888888cccc",
      ].map((head, i) => sendBack(head, "failed-check", 20 + i)),
    ];
    const counts = sendBackCategories(events, WINDOW);
    expect(counts.otherShare).toBeCloseTo(1 / 11);
    expect(counts.otherOverThreshold).toBe(false);
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
    expect(sendBackCategories(events, WINDOW).byCategory).toEqual({
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

    const report = categoryReport([merged, abandoned], new Map(), WINDOW);
    expect(report.perPrHead.byCategory).toEqual({
      ...NONE,
      conflict: 1,
      "failed-check": 1,
    });
    expect(report.perMergedChange.byCategory).toEqual({
      ...NONE,
      conflict: 1,
    });
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

  it("counts a send-back from before categories existed, and leaves out one at the window's end", () => {
    expect(
      sendBacksInRange(
        [sendBack(HEAD_A, undefined, 10), sendBack(HEAD_B, "conflict", 1000)],
        WINDOW,
      ),
    ).toBe(1);
  });
});
