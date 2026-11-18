import { describe, expect, it } from "vitest";
import { sendBackCategoryLines } from "./flow-lines.js";

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
} as const;

const LEGACY =
  "legacy 20 (recorded before 2026-11-16, when a category became required)";

/** Counts as the report gives them when `other` has been read over the minimum sample. */
const OVER = {
  byCategory: { ...ZERO, "failed-check": 2, other: 1 },
  legacy: 20,
  uncategorised: 3,
  otherThreshold: 0.1,
  categorised: 3,
  otherShare: 1 / 3,
  minCategorised: 3,
  otherReading: "over",
  otherOverThreshold: true,
} as const;

describe("sendBackCategoryLines", () => {
  it("lists every category in the list's order, then the legacy, uncategorised and categorised counts, and the share of other", () => {
    expect(
      sendBackCategoryLines({
        perPrHead: OVER,
        perMergedChange: { ...OVER, legacy: 0, uncategorised: 0 },
      }),
    ).toEqual([
      `Send-backs by category, per PR head: declaration 0, pattern-mismatch 0, failed-check 2, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 1; ${LEGACY}; uncategorised 3; categorised 3; other 33% of categorised, over 10%: the list may need an entry`,
      "Send-backs by category, per merged change: declaration 0, pattern-mismatch 0, failed-check 2, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 1; legacy 0 (recorded before 2026-11-16, when a category became required); uncategorised 0; categorised 3; other 33% of categorised, over 10%: the list may need an entry",
    ]);
  });

  it("reads a share below the minimum sample as insufficient, naming the sample and the minimum, never as over or within", () => {
    const thin = {
      ...OVER,
      byCategory: { ...ZERO, other: 2, scope: 6 },
      categorised: 8,
      otherShare: 0.25,
      minCategorised: 20,
      otherReading: "insufficient",
      otherOverThreshold: false,
    } as const;
    const [perPrHead] = sendBackCategoryLines({
      perPrHead: thin,
      perMergedChange: thin,
    });
    expect(perPrHead).toMatch(
      /; categorised 8; other 25% of categorised, insufficient: 8 of 20 categorised send-backs needed$/,
    );
  });

  it("prints no suffix for a share read within its threshold", () => {
    const fine = {
      ...OVER,
      byCategory: { ...ZERO, other: 1, scope: 19 },
      categorised: 20,
      otherShare: 0.05,
      minCategorised: 20,
      otherReading: "within",
      otherOverThreshold: false,
    } as const;
    const [perPrHead] = sendBackCategoryLines({
      perPrHead: fine,
      perMergedChange: fine,
    });
    expect(perPrHead).toMatch(/; categorised 20; other 5% of categorised$/);
  });

  it("says there is no share when no send-back is categorised, rather than printing zero, and keeps the legacy count apart", () => {
    const none = {
      ...OVER,
      byCategory: ZERO,
      legacy: 22,
      uncategorised: 0,
      categorised: 0,
      otherShare: null,
      otherReading: "insufficient",
      otherOverThreshold: false,
    } as const;
    const [perPrHead] = sendBackCategoryLines({
      perPrHead: none,
      perMergedChange: none,
    });
    expect(perPrHead).toMatch(
      /; legacy 22 \(recorded before 2026-11-16, when a category became required\); uncategorised 0; categorised 0; no categorised send-backs$/,
    );
  });
});
