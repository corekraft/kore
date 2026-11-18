import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
} from "../../src/testing/index.js";
import { SEND_BACK_COUNT_KEYS } from "./flow-report-keys-support.js";

/** A stored send-back line on PR `number` at the head `sha`, with a category when given. */
const sendBackLine = (
  id: string,
  occurredAt: string,
  number: number,
  category?: string,
) =>
  `${JSON.stringify({
    schema: 1,
    id,
    source: "github",
    kind: "send-back",
    occurredAt,
    recordedAt: occurredAt,
    number,
    label: `reason @${String(number).padStart(7, "a")}`,
    ...(category === undefined ? {} : { category }),
  })}\n`;

const EXPECTED_PER_PR_HEAD = {
  byCategory: {
    declaration: 0,
    "pattern-mismatch": 0,
    "failed-check": 0,
    conflict: 0,
    "missing-proof": 2,
    "rule-break": 0,
    scope: 0,
    "wrong-statement": 0,
    other: 1,
  },
  legacy: 2,
  uncategorised: 0,
  otherThreshold: 0.1,
  categorised: 3,
  otherShare: 1 / 3,
  minCategorised: 20,
  otherReading: "insufficient",
  otherOverThreshold: false,
};

describe("flow report send-backs by category, legacy and the minimum (#1094)", () => {
  /** Two before 2026-11-16 with no category, three after it with one, and one line with a category this build does not know. */
  function ledgerWithSendBacks(extra: string[] = []) {
    const h = harness();
    h.fs.files.set(
      DEFAULT,
      [
        sendBackLine("a1", "2026-11-13T10:00:00.000Z", 1),
        sendBackLine("a2", "2026-11-15T23:59:59.000Z", 2),
        sendBackLine("b1", "2026-11-16T00:00:00.000Z", 3, "other"),
        sendBackLine("b2", "2026-11-17T10:00:00.000Z", 4, "missing-proof"),
        sendBackLine("b3", "2026-11-17T11:00:00.000Z", 5, "missing-proof"),
        sendBackLine("c1", "2026-11-17T12:00:00.000Z", 6, "wrong-claim"),
      ].join(""),
    );
    return {
      h,
      argv: ["flow", "report", "--as-of", "2026-11-18T00:00:00Z", ...extra],
    };
  }

  it("counts two legacy and three categorised send-backs, skips the line with an unknown category, and reads the share insufficient below 20", async () => {
    const { h, argv } = ledgerWithSendBacks(["--json"]);
    expect(await run(argv, h.deps)).toBe(0);
    const report = JSON.parse(h.out()) as {
      sendBackCategories: {
        perPrHead: Record<string, unknown>;
        perMergedChange: Record<string, unknown>;
      };
      sendBackTiers: { unlinked: { sendBacks: Record<string, unknown> } };
      skippedLines: number;
    };
    expect(report.skippedLines).toBe(1);
    expect(report.sendBackCategories.perPrHead).toEqual(EXPECTED_PER_PR_HEAD);
    expect(Object.keys(report.sendBackCategories.perPrHead)).toEqual(
      SEND_BACK_COUNT_KEYS,
    );
    expect(Object.keys(report.sendBackCategories.perMergedChange)).toEqual(
      SEND_BACK_COUNT_KEYS,
    );
    expect(Object.keys(report.sendBackTiers.unlinked.sendBacks)).toEqual(
      SEND_BACK_COUNT_KEYS,
    );
  });

  it("prints the legacy count, the categorised count and the share in the text report", async () => {
    const { h, argv } = ledgerWithSendBacks();
    expect(await run(argv, h.deps)).toBe(0);
    expect(h.out()).toContain(
      "Send-backs by category, per PR head: declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 2, rule-break 0, scope 0, wrong-statement 0, other 1; legacy 2 (recorded before 2026-11-16, when a category became required); uncategorised 0; categorised 3; other 33% of categorised, insufficient: 3 of 20 categorised send-backs needed",
    );
    expect(h.out()).toContain("skipped 1 malformed ledger line(s)");
  });
});
