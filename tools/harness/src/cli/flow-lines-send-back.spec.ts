import { describe, expect, it, vi } from "vitest";
import {
  SEND_BACK_CATEGORIES,
  type SendBackCategory,
} from "../ledger/index.js";
import type { CategoryCounts, SendBackTiers } from "../flow/index.js";
import { sendBackTierLines } from "./flow-lines-send-back.js";

vi.mock("./flow-lines-writer-cost.js", () => ({
  changes: (n: number) => `${n} merged change${n === 1 ? "" : "s"}`,
}));

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

const NONE = Object.fromEntries(
  SEND_BACK_CATEGORIES.map((c) => [c, 0]),
) as Record<SendBackCategory, number>;

const EMPTY: CategoryCounts = {
  byCategory: NONE,
  uncategorised: 0,
  otherShare: null,
  otherThreshold: 0.1,
  otherOverThreshold: false,
};

describe("sendBackTierLines: send-backs by category per writer tier, with the unlinked row (#1045)", () => {
  it("prints each tier's categories, its merged changes and its rework rate with the count it is read over, in tier order", () => {
    const report: SendBackTiers = {
      tiers: {
        [HAIKU]: {
          mergedChanges: 3,
          sendBacks: {
            byCategory: { ...NONE, scope: 1, other: 1 },
            uncategorised: 0,
            otherShare: 0.5,
            otherThreshold: 0.1,
            otherOverThreshold: true,
          },
          rework: 1,
          reworkPerMergedChange: 0.3333,
        },
        [SONNET]: {
          mergedChanges: 0,
          sendBacks: EMPTY,
          rework: 0,
          reworkPerMergedChange: null,
        },
      },
      unlinked: { mergedChanges: 0, sendBacks: EMPTY },
    };

    expect(sendBackTierLines(report).slice(0, 2)).toEqual([
      "Send-backs by category, writer tier claude-haiku-5-5, 3 merged changes: declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 0, rule-break 0, scope 1, wrong-statement 0, other 1; uncategorised 0; other 50% of categorised, over 10%: the list may need an entry; rework 1 over 3 merged changes, 0.3333 per merged change",
      "Send-backs by category, writer tier claude-sonnet-5-5, 0 merged changes: declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 0; uncategorised 0; no categorised send-backs; rework 0 over 0 merged changes, per merged change not read",
    ]);
  });

  it("prints the unlinked row last, with its merged changes and its send-backs, and no rework since no writer tier is read", () => {
    const report: SendBackTiers = {
      tiers: {},
      unlinked: {
        mergedChanges: 1,
        sendBacks: {
          byCategory: { ...NONE, other: 1 },
          uncategorised: 0,
          otherShare: 1,
          otherThreshold: 0.1,
          otherOverThreshold: true,
        },
      },
    };

    expect(sendBackTierLines(report)).toEqual([
      "Send-backs by category, unlinked row (1 merged change with no writer tier): declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 1; uncategorised 0; other 100% of categorised, over 10%: the list may need an entry; rework not read, no writer tier",
    ]);
  });

  it("names an uncategorised send-back in the row it is in, never as another category", () => {
    const report: SendBackTiers = {
      tiers: {
        [HAIKU]: {
          mergedChanges: 1,
          sendBacks: { ...EMPTY, uncategorised: 2 },
          rework: 0,
          reworkPerMergedChange: 0,
        },
      },
      unlinked: { mergedChanges: 0, sendBacks: EMPTY },
    };

    expect(sendBackTierLines(report)[0]).toBe(
      "Send-backs by category, writer tier claude-haiku-5-5, 1 merged change: declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 0; uncategorised 2; no categorised send-backs; rework 0 over 1 merged change, 0 per merged change",
    );
  });
});
