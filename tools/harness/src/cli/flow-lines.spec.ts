import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import {
  frictionLine,
  metricLine,
  reviewMissLines,
  reworkLines,
  sendBackCategoryLines,
  tokensPerMergedChangeLine,
} from "./flow-lines.js";

const ZERO = {
  declaration: 0,
  "pattern-mismatch": 0,
  "failed-check": 0,
  conflict: 0,
  "missing-proof": 0,
  "rule-break": 0,
  scope: 0,
  other: 0,
} as const;

describe("sendBackCategoryLines", () => {
  it("lists every category in the list's order, the uncategorised count, and the share of other", () => {
    const counts = {
      byCategory: { ...ZERO, "failed-check": 2, other: 1 },
      uncategorised: 3,
      otherShare: 1 / 3,
      otherThreshold: 0.1,
      otherOverThreshold: true,
    };
    expect(
      sendBackCategoryLines({
        perPrHead: counts,
        perMergedChange: { ...counts, uncategorised: 0 },
      }),
    ).toEqual([
      "Send-backs by category, per PR head: declaration 0, pattern-mismatch 0, failed-check 2, conflict 0, missing-proof 0, rule-break 0, scope 0, other 1; uncategorised 3; other 33% of categorised, over 10%: the list may need an entry",
      "Send-backs by category, per merged change: declaration 0, pattern-mismatch 0, failed-check 2, conflict 0, missing-proof 0, rule-break 0, scope 0, other 1; uncategorised 0; other 33% of categorised, over 10%: the list may need an entry",
    ]);
  });

  it("says there is no share when no send-back is categorised, rather than printing zero", () => {
    const none = {
      byCategory: ZERO,
      uncategorised: 2,
      otherShare: null,
      otherThreshold: 0.1,
      otherOverThreshold: false,
    };
    const [perPrHead] = sendBackCategoryLines({
      perPrHead: none,
      perMergedChange: none,
    });
    expect(perPrHead).toMatch(/; uncategorised 2; no categorised send-backs$/);
  });
});

const NONE = {
  status: "insufficient history",
  closedIdeas: 1,
  needed: 6,
} as const;

describe("metricLine", () => {
  it("says why a metric has no figure rather than printing zero", () => {
    expect(metricLine("Send-backs per idea", NONE, 5)).toBe(
      "Send-backs per idea: insufficient history, 1 of 6 closed ideas",
    );
  });

  it("marks a worsened metric against its rounded trailing average", () => {
    const ok = {
      status: "ok",
      currentIdea: "#9",
      current: 4,
      trailingAverage: 1.456,
      maxIncrease: 0.25,
      worsened: true,
    } as const;
    expect(metricLine("Escalations per idea", ok, 5)).toBe(
      "Escalations per idea: #9 4, average of the 5 ideas before it 1.46 (worsened)",
    );
  });
});

describe("reworkLines", () => {
  it("lists escalations, send-backs and friction in that order", () => {
    const lines = reworkLines({
      trailingIdeas: 5,
      escalationsPerIdea: NONE,
      sendBacksPerIdea: NONE,
      frictionPerIdea: NONE,
      followUpsPerWriterSession: NONE,
      mainFollowUpsPerWriterSession: NONE,
      followUps: { writerSessions: 0, bySender: [] },
    });
    expect(lines.map((l) => l.split(":")[0])).toEqual([
      "Escalations per idea",
      "Send-backs per idea",
      "Friction events per idea",
    ]);
  });
});

describe("frictionLine", () => {
  const of = (f: Partial<FlowReport["friction"]>) =>
    frictionLine({ total: 0, sources: [], unknownKinds: 0, ...f });

  it("says none for an empty ledger", () => {
    expect(of({})).toBe("Friction: none");
  });

  it("names each source with its count", () => {
    expect(
      of({
        total: 3,
        sources: [
          { kind: "command", source: "local up", events: 2 },
          { kind: "pane", source: "w1:p2", events: 1 },
        ],
      }),
    ).toBe("Friction: 3 (local up 2, w1:p2 1)");
  });

  it("counts the unknown record kinds it ignored", () => {
    expect(of({ unknownKinds: 2 })).toBe(
      "Friction: none; 2 unknown kind(s) ignored",
    );
  });
});

describe("tokensPerMergedChangeLine (#829)", () => {
  const TRAILING = { trailingDays: 7, minMergedChanges: 5 };
  const of = (
    current: FlowReport["tokensPerMergedChange"]["current"],
    trailingAverage: FlowReport["tokensPerMergedChange"]["trailingAverage"],
  ) =>
    tokensPerMergedChangeLine({
      ...TRAILING,
      current,
      trailingAverage,
    });

  it("reads the window's tokens per merged change against the trailing average", () => {
    expect(
      of(
        { status: "ok", tokens: 350, merged: 2, perMerged: 175 },
        { status: "ok", tokens: 600, merged: 5, perMerged: 120 },
      ),
    ).toBe(
      "Tokens per merged change: 175 (350 tokens over 2 merged changes); average 120 over the trailing 7 days",
    );
  });

  it("says the window's figure is not read, never a zero, below the minimum", () => {
    expect(
      of(
        { status: "insufficient merged changes", merged: 1, needed: 5 },
        { status: "ok", tokens: 600, merged: 5, perMerged: 120 },
      ),
    ).toBe(
      "Tokens per merged change: not read, 1 merged change in this range (5 needed); average 120 over the trailing 7 days",
    );
  });

  it("says the trailing average has no value when its days had too few merged changes", () => {
    expect(
      of(
        { status: "ok", tokens: 350, merged: 2, perMerged: 175 },
        { status: "insufficient merged changes", merged: 0, needed: 5 },
      ),
    ).toBe(
      "Tokens per merged change: 175 (350 tokens over 2 merged changes); no average: 0 merged changes in the trailing 7 days (5 needed)",
    );
  });
});

describe("reviewMissLines (#851)", () => {
  const figure = (
    overrides: Partial<FlowReport["reviewMisses"]> = {},
  ): FlowReport["reviewMisses"] => ({
    trailingDays: 7,
    reviews: 4,
    unrecorded: 0,
    passedRuleBreak: {
      count: 1,
      ratio: 0.25,
      trailingAverage: 0.1,
      worsened: true,
    },
    foundViolation: { count: 2, share: 0.5, trailingAverage: 0.2 },
    ...overrides,
  });

  it("gives each figure against its trailing average, and marks the miss rate worsened", () => {
    expect(reviewMissLines(figure())).toEqual([
      "Passed reviews later sent back for a rule break: 1 of 4 reviews (25%), trailing average 10% over the trailing 7 days (worsened)",
      "Reviews that found a violation: 2 of 4 (50%), trailing average 20% over the trailing 7 days",
    ]);
  });

  it("says the first window has no trailing average, a baseline, rather than printing zero", () => {
    const lines = reviewMissLines(
      figure({
        passedRuleBreak: {
          count: 0,
          ratio: 0,
          trailingAverage: null,
          worsened: false,
        },
        foundViolation: { count: 0, share: 0, trailingAverage: null },
      }),
    );
    expect(lines[0]).toContain("no reviews in the trailing days");
    expect(lines[0]).not.toContain("(worsened)");
    expect(lines[1]).toContain("no reviews in the trailing days");
  });

  it("says there are no reviews in the range rather than printing a rate", () => {
    const lines = reviewMissLines(
      figure({
        reviews: 0,
        passedRuleBreak: {
          count: 0,
          ratio: null,
          trailingAverage: null,
          worsened: false,
        },
        foundViolation: { count: 0, share: null, trailingAverage: null },
      }),
    );
    expect(lines).toEqual([
      "Passed reviews later sent back for a rule break: no recorded reviews in this range",
      "Reviews that found a violation: no recorded reviews in this range",
    ]);
  });

  it("counts the reviews from before the verdict was recorded that it left out", () => {
    const lines = reviewMissLines(figure({ unrecorded: 3 }));
    expect(lines[0]).toContain(
      "; 3 from before the verdict was recorded left out",
    );
  });
});
