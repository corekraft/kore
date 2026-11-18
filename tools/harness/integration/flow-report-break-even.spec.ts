import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../src/ledger/index.js";
import { buildReport } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";

const START = Date.parse("2026-11-17T00:00:00.000Z");
const atStart: typeof at = (seconds, kind, fields) =>
  at((START - T0) / 1000 + seconds, kind, fields);

const ASOF = new Date(START + 1_000_000_000);
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const MILLION = 1_000_000;

// Window: 1000 s to 2000 s after START.
const WINDOW = {
  since: new Date(START + 1000 * 1000),
  until: new Date(START + 2000 * 1000),
};

const launch = (agent: string, pane: string, tier: string) =>
  atStart(0, "session.launch", { agent, pane, role: "writer", tier });

/** One model's cumulative input tokens for a session at the low prompt step: the dollars are tokens over a million times the price. */
const spend = (seconds: number, agent: string, model: string, tokens: number) =>
  atStart(seconds, "token.split", {
    agent,
    model,
    lowInput: tokens,
    lowCacheRead: 0,
    lowOutput: 0,
    highInput: 0,
    highCacheRead: 0,
    highOutput: 0,
  });

/** A principles-review verdict as `review post` records it: the PR, the head in the label, the count and the short rule labels. */
const verdict = (
  seconds: number,
  number: number,
  head: string,
  findings: number,
  rules?: string,
) =>
  atStart(seconds, "review.run", {
    number,
    label: `posted:${head}`,
    findings,
    ...(rules === undefined ? {} : { rules }),
  });

// Haiku writes PRs 11 to 13 (writer spend $0.10 each) and PR 14 ($0.50), which is sent back and
// then sent to. Sonnet writes PRs 21 to 23 ($2 each). Nothing else is spent, so each change's
// all-in dollars are its writer's. Haiku medians: $0.10 with no rework, $0.50 with one round; one
// round adds $0.40; Sonnet's median is $2: (2 - 0.1) / 0.4 = 4.75 rework rounds per merged change.
const EVENTS: LedgerEvent[] = [
  launch("h1-writer", "w1:p1", HAIKU),
  launch("h2-writer", "w1:p2", HAIKU),
  launch("h3-writer", "w1:p3", HAIKU),
  launch("h4-writer", "w1:p4", HAIKU),
  launch("s1-writer", "w1:p5", SONNET),
  launch("s2-writer", "w1:p6", SONNET),
  launch("s3-writer", "w1:p7", SONNET),
  ...(
    [
      [11, "h1-writer"],
      [12, "h2-writer"],
      [13, "h3-writer"],
      [14, "h4-writer"],
      [21, "s1-writer"],
      [22, "s2-writer"],
      [23, "s3-writer"],
    ] satisfies [number, string][]
  ).map(([number, agent]) => atStart(1, "pr.linked", { number, agent })),
  spend(1100, "h1-writer", HAIKU, MILLION),
  spend(1100, "h2-writer", HAIKU, MILLION),
  spend(1100, "h3-writer", HAIKU, MILLION),
  spend(1100, "h4-writer", HAIKU, 5 * MILLION),
  spend(1100, "s1-writer", SONNET, MILLION),
  spend(1100, "s2-writer", SONNET, MILLION),
  spend(1100, "s3-writer", SONNET, MILLION),
  atStart(1150, "send-back", {
    number: 14,
    category: "scope",
    label: "scope @cccccc1",
  }),
  atStart(1200, "session.send", { agent: "h4-writer", pane: "w1:p4" }),
  verdict(1210, 11, "aaaaaaa", 2, "max-lines,pin-everything"),
  verdict(1220, 14, "bbbbbbb", 1, "max-lines"),
  verdict(1230, 21, "ddddddd", 1, "fail-closed"),
  verdict(1240, 99, "eeeeeee", 1, "max-lines"),
  verdict(1250, 12, "fffffff", 0),
  ...[11, 12, 13, 14, 21, 22, 23].map((number, i) =>
    atStart(1300 + i, "pr.merged", { number }),
  ),
];

const report = (extra: Record<string, unknown> = {}) =>
  buildReport(EVENTS, {
    asOf: ASOF,
    minCompletedIdeas: 1,
    cost: { minMergedChanges: 3 },
    ...WINDOW,
    ...extra,
  });

describe("flow report violations by rule per writer tier (#1051)", () => {
  it("counts each cited rule label per tier with the count behind its share, and a clean verdict nowhere", () => {
    const r = report();

    expect(r.violationsByRule.tiers[HAIKU]).toEqual({
      failedVerdicts: 2,
      unlabelled: 0,
      citations: 3,
      rules: [
        { rule: "max-lines", count: 2, share: 0.6667 },
        { rule: "pin-everything", count: 1, share: 0.3333 },
      ],
    });
    expect(r.violationsByRule.tiers[SONNET]).toEqual({
      failedVerdicts: 1,
      unlabelled: 0,
      citations: 1,
      rules: [{ rule: "fail-closed", count: 1, share: 1 }],
    });
  });

  it("puts a verdict on a pull request with no linked writer in the unlinked row, not in a tier", () => {
    const r = report();

    expect(r.violationsByRule.unlinked).toEqual({
      failedVerdicts: 1,
      unlabelled: 0,
      citations: 1,
      rules: [{ rule: "max-lines", count: 1, share: 1 }],
    });
  });

  it("splits at a date, holding nothing without one", () => {
    const split = report({ splitAt: new Date(START + 1215 * 1000) });

    expect(
      split.violationsByRuleSplit?.before.tiers[HAIKU]?.failedVerdicts,
    ).toBe(1);
    expect(
      split.violationsByRuleSplit?.after.tiers[HAIKU]?.failedVerdicts,
    ).toBe(1);
    expect("violationsByRuleSplit" in report()).toBe(false);
  });
});

describe("flow report Haiku-Sonnet break-even (#1051)", () => {
  it("reads the rework rounds per merged change at which Haiku's median reaches Sonnet's, with the medians it uses", () => {
    expect(report().breakEven).toEqual({
      status: "ok",
      needed: 3,
      haiku: {
        tier: HAIKU,
        mergedChanges: 4,
        noRework: { changes: 3, median: 0.1 },
        oneRound: { changes: 1, median: 0.5 },
      },
      sonnet: { tier: SONNET, mergedChanges: 3, median: 2 },
      costPerReworkRound: 0.4,
      reworkRoundsPerMergedChange: 4.75,
    });
  });

  it("reports a tier below the minimum merged changes as insufficient, with no break-even", () => {
    const r = report({ cost: { minMergedChanges: 4 } });

    expect(r.breakEven).toEqual({
      status: "insufficient merged changes",
      needed: 4,
      haiku: { tier: HAIKU, mergedChanges: 4 },
      sonnet: { tier: SONNET, mergedChanges: 3 },
    });
  });

  it("reads each side of the split date on its own merged changes, a side short of the minimum insufficient", () => {
    const split = report({ splitAt: new Date(START + 1303 * 1000) });

    expect(split.breakEvenSplit?.at).toBe("2026-11-17T00:21:43.000Z");
    expect(split.breakEvenSplit?.before.status).toBe(
      "insufficient merged changes",
    );
    expect(split.breakEvenSplit?.after.status).toBe(
      "insufficient merged changes",
    );
    expect("breakEvenSplit" in report()).toBe(false);
  });
});
