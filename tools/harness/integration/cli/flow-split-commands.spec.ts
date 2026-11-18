import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import type { FlowReport } from "../../src/flow/index.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
} from "../../src/testing/index.js";
import { finishedIdea } from "../../src/testing/index.js";
import {
  BREAK_EVEN_INSUFFICIENT_KEYS,
  KEYS,
  REVIEW_ROUNDS_KEYS,
  REVIEW_ROUNDS_TIER_KEYS,
  REVIEW_ROUNDS_UNLINKED_KEYS,
  SPLIT_KEYS,
  SPLIT_SIDE_KEYS,
  VIOLATIONS_KEYS,
  VIOLATIONS_ROW_KEYS,
} from "./flow-report-keys-support.js";

// finishedIdea events sit a few seconds after 2026-01-02T00:00:00Z.
const SPLIT = "2026-01-02T00:00:15Z";

function seeded(extra: string[] = []) {
  const h = harness();
  const events = [
    ...finishedIdea(1, { approval: 3000 }),
    ...finishedIdea(2, { approval: 1000 }, 10_000),
    ...finishedIdea(3, { approval: 2000 }, 20_000),
  ];
  h.fs.files.set(DEFAULT, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return { h, argv: ["flow", "report", ...extra] };
}

describe("flow report --split-at (#1047)", () => {
  it("adds sendBackTiersSplit to the JSON and nothing else, with the tier figures of both sides", async () => {
    const { h, argv } = seeded(["--json", "--split-at", SPLIT]);

    expect(await run(argv, h.deps)).toBe(0);
    const report = JSON.parse(h.out()) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(SPLIT_KEYS);
    const split = report["sendBackTiersSplit"] as Record<string, unknown>;
    expect(Object.keys(split)).toEqual(SPLIT_SIDE_KEYS);
    expect(split["at"]).toBe("2026-01-02T00:00:15.000Z");
    const tierKeys = Object.keys(report["sendBackTiers"] as object);
    expect(Object.keys(split["before"] as object)).toEqual(tierKeys);
    expect(Object.keys(split["after"] as object)).toEqual(tierKeys);
  });

  it("adds reviewRoundsSplit with the date and the review rounds of both sides, each with the keys of reviewRounds (#1050)", async () => {
    const { h, argv } = seeded(["--json", "--split-at", SPLIT]);

    expect(await run(argv, h.deps)).toBe(0);
    const report: FlowReport = JSON.parse(h.out());
    const rounds = report.reviewRounds;
    expect(Object.keys(rounds)).toEqual(REVIEW_ROUNDS_KEYS);
    expect(Object.keys(rounds.unlinked)).toEqual(REVIEW_ROUNDS_UNLINKED_KEYS);
    for (const row of Object.values(rounds.tiers)) {
      expect(Object.keys(row)).toEqual(REVIEW_ROUNDS_TIER_KEYS);
    }
    const split = report.reviewRoundsSplit;
    expect(Object.keys(split ?? {})).toEqual(SPLIT_SIDE_KEYS);
    expect(split?.at).toBe("2026-01-02T00:00:15.000Z");
    for (const side of [split?.before, split?.after]) {
      expect(Object.keys(side ?? {})).toEqual(REVIEW_ROUNDS_KEYS);
      expect(Object.keys(side?.tiers ?? {})).toEqual(Object.keys(rounds.tiers));
    }
  });
});

describe("flow report --split-at, the violations by rule and the break-even (#1051)", () => {
  it("adds violationsByRuleSplit and breakEvenSplit with the date and both sides, each with the keys of its unsplit figure (#1051)", async () => {
    const { h, argv } = seeded(["--json", "--split-at", SPLIT]);

    expect(await run(argv, h.deps)).toBe(0);
    const report: FlowReport = JSON.parse(h.out());
    expect(Object.keys(report.violationsByRule)).toEqual(VIOLATIONS_KEYS);
    expect(Object.keys(report.violationsByRule.unlinked)).toEqual(
      VIOLATIONS_ROW_KEYS,
    );
    expect(Object.keys(report.breakEven)).toEqual(BREAK_EVEN_INSUFFICIENT_KEYS);
    const violations = report.violationsByRuleSplit;
    expect(Object.keys(violations ?? {})).toEqual(SPLIT_SIDE_KEYS);
    expect(violations?.at).toBe("2026-01-02T00:00:15.000Z");
    const breakEven = report.breakEvenSplit;
    expect(Object.keys(breakEven ?? {})).toEqual(SPLIT_SIDE_KEYS);
    expect(breakEven?.at).toBe("2026-01-02T00:00:15.000Z");
    for (const side of [violations?.before, violations?.after]) {
      expect(Object.keys(side ?? {})).toEqual(VIOLATIONS_KEYS);
    }
    for (const side of [breakEven?.before, breakEven?.after]) {
      expect(Object.keys(side ?? {})).toEqual(BREAK_EVEN_INSUFFICIENT_KEYS);
    }
  });
});

describe("flow report --split-at, the whole report", () => {
  it("keeps exactly the keys it had without the flag", async () => {
    const { h, argv } = seeded(["--json"]);

    expect(await run(argv, h.deps)).toBe(0);
    expect(Object.keys(JSON.parse(h.out()) as object)).toEqual(KEYS);
  });

  it("prints the two sides' tier lines in the text report, and none without the flag", async () => {
    const split = seeded(["--split-at", SPLIT]);
    await run(split.argv, split.h.deps);
    const plain = seeded();
    await run(plain.argv, plain.h.deps);

    expect(split.h.out()).toContain(
      "Send-backs by writer tier, before 2026-01-02T00:00:15.000Z:\n",
    );
    expect(split.h.out()).toContain(
      "Send-backs by writer tier, on or after 2026-01-02T00:00:15.000Z:\n",
    );
    expect(plain.h.out()).not.toContain("Send-backs by writer tier");
    expect(split.h.out()).toContain(
      "Haiku-Sonnet break-even by writer tier, before 2026-01-02T00:00:15.000Z:\n",
    );
    expect(split.h.out()).toContain(
      "Review violations by rule by writer tier, on or after 2026-01-02T00:00:15.000Z:\n",
    );
    expect(plain.h.out()).toContain(
      "Haiku-Sonnet break-even not read: insufficient merged changes, claude-haiku-5-5 0 merged changes, claude-sonnet-5-5 0 merged changes, 5 needed in each tier; claude-haiku-5-5 rework per merged change not read\n",
    );
    expect(plain.h.out()).not.toContain("break-even by writer tier");
  });

  it("refuses a split date outside --since before reading the ledger", async () => {
    const { h, argv } = seeded([
      "--since",
      "2026-01-02T00:00:10Z",
      "--split-at",
      "2026-01-02T00:00:01Z",
    ]);

    expect(await run(argv, h.deps)).toBe(2);
    expect(h.err()).toContain("Invalid --split-at 2026-01-02T00:00:01.000Z");
  });
});
