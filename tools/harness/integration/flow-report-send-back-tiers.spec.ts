import { describe, expect, it } from "vitest";
import {
  SEND_BACK_CATEGORIES,
  type LedgerEvent,
  type SendBackCategory,
} from "../src/ledger/index.js";
import { buildReport } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";

// Send-backs before 2026-11-16 are legacy (#1094), so these events run from the day after it.
const START = Date.parse("2026-11-17T00:00:00.000Z");
const atStart: typeof at = (seconds, kind, fields) =>
  at((START - T0) / 1000 + seconds, kind, fields);

const ASOF = new Date(START + 1_000_000_000);
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

/** Every category at zero, with the given ones counted. */
const counted = (over: Partial<Record<SendBackCategory, number>>) => ({
  ...(Object.fromEntries(SEND_BACK_CATEGORIES.map((c) => [c, 0])) as Record<
    SendBackCategory,
    number
  >),
  ...over,
});

// Window: 1000 s to 2000 s after T0. Writers launch before it, as the join reads them.
const WINDOW = {
  since: new Date(START + 1000 * 1000),
  until: new Date(START + 2000 * 1000),
};

const EVENTS: LedgerEvent[] = [
  atStart(0, "session.launch", {
    agent: "h-writer",
    pane: "w1:p1",
    role: "writer",
    tier: HAIKU,
  }),
  atStart(0, "session.launch", {
    agent: "s-writer",
    pane: "w1:p2",
    role: "writer",
    tier: SONNET,
  }),
  atStart(1, "pr.linked", { number: 11, agent: "h-writer" }),
  atStart(1, "pr.linked", { number: 12, agent: "s-writer" }),
  atStart(1100, "pr.merged", { number: 11 }), // joins to haiku
  atStart(1300, "pr.merged", { number: 13 }), // no writer link: unlinked
  atStart(1150, "send-back", { number: 11, category: "scope" }),
  atStart(1160, "send-back", { number: 13 }), // no category, no link: unlinked, uncategorised
  atStart(1170, "send-back", { number: 12, category: "other" }), // sonnet, no send after it
  atStart(1200, "session.send", { agent: "h-writer", pane: "w1:p1" }), // after haiku's send-back: rework
];

describe("flow report send-backs by writer tier (#1045)", () => {
  it("counts each writer tier's send-backs by category with its rework, and an unlinked row for what joins to no tier", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    // Every priced tier has a row; only the two writer tiers and the unlinked row are read here.
    expect(r.sendBackTiers).toMatchObject({
      tiers: {
        [HAIKU]: {
          mergedChanges: 1,
          sendBacks: {
            byCategory: counted({ scope: 1 }),
            legacy: 0,
            uncategorised: 0,
            categorised: 1,
            otherShare: 0,
            otherThreshold: 0.1,
            minCategorised: 20,
            otherReading: "insufficient",
            otherOverThreshold: false,
          },
          rework: 1,
          reworkPerMergedChange: 1,
        },
        [SONNET]: {
          mergedChanges: 0,
          sendBacks: {
            byCategory: counted({ other: 1 }),
            legacy: 0,
            uncategorised: 0,
            categorised: 1,
            otherShare: 1,
            otherThreshold: 0.1,
            minCategorised: 20,
            otherReading: "insufficient",
            otherOverThreshold: false,
          },
          rework: 0,
          reworkPerMergedChange: null,
        },
      },
      unlinked: {
        mergedChanges: 1,
        sendBacks: {
          byCategory: counted({}),
          legacy: 0,
          uncategorised: 1,
          categorised: 0,
          otherShare: null,
          otherThreshold: 0.1,
          minCategorised: 20,
          otherReading: "insufficient",
          otherOverThreshold: false,
        },
      },
    });
  });
});

// Split at 1500 s: a Haiku change merged just before it, a Haiku change merged exactly at it, and a
// Sonnet change merged after it. The window keeps its 1000 s and 2000 s bounds.
const SPLIT_EVENTS: LedgerEvent[] = [
  atStart(0, "session.launch", {
    agent: "h-writer",
    pane: "w1:p1",
    role: "writer",
    tier: HAIKU,
  }),
  atStart(0, "session.launch", {
    agent: "s-writer",
    pane: "w1:p2",
    role: "writer",
    tier: SONNET,
  }),
  atStart(1, "pr.linked", { number: 21, agent: "h-writer" }),
  atStart(1, "pr.linked", { number: 22, agent: "h-writer" }),
  atStart(1, "pr.linked", { number: 23, agent: "s-writer" }),
  atStart(1100, "send-back", { number: 21, category: "scope" }),
  atStart(1400, "pr.merged", { number: 21 }), // before the split
  atStart(1500, "pr.merged", { number: 22 }), // exactly at the split: after
  atStart(1600, "send-back", { number: 22, category: "failed-check" }),
  atStart(1700, "send-back", { number: 99, category: "other" }), // unlinked, after
  atStart(1800, "pr.merged", { number: 23 }), // after
];

describe("flow report send-backs by writer tier, split at a date (#1047)", () => {
  const splitReport = (extra: object = {}) =>
    buildReport(SPLIT_EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      splitAt: new Date(START + 1500 * 1000),
      ...extra,
    });

  it("reads the tier figures once before the date and once from it, with a change merged exactly at the date on the after side", () => {
    const split = splitReport().sendBackTiersSplit;

    expect(split?.at).toBe(new Date(START + 1500 * 1000).toISOString());
    expect(split?.before.tiers[HAIKU]).toMatchObject({
      mergedChanges: 1,
      sendBacks: { byCategory: counted({ scope: 1 }) },
    });
    expect(split?.before.tiers[SONNET]).toMatchObject({ mergedChanges: 0 });
    expect(split?.after.tiers[HAIKU]).toMatchObject({
      mergedChanges: 1,
      sendBacks: { byCategory: counted({ "failed-check": 1 }) },
    });
    expect(split?.after.tiers[SONNET]).toMatchObject({ mergedChanges: 1 });
    expect(split?.before.unlinked).toMatchObject({ mergedChanges: 0 });
    expect(split?.after.unlinked).toMatchObject({
      mergedChanges: 0,
      sendBacks: { byCategory: counted({ other: 1 }) },
    });
  });

  it("leaves the unsplit figures and every other key of the report exactly as they are without a split", () => {
    const { sendBackTiersSplit: _split, ...withSplit } = splitReport();
    const without = buildReport(SPLIT_EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(without).not.toHaveProperty("sendBackTiersSplit");
    expect(withSplit).toEqual(without);
  });

  it("keeps the date bounds working with the split: a change before --since is on neither side", () => {
    const split = splitReport({
      since: new Date(START + 1450 * 1000),
    }).sendBackTiersSplit;

    expect(split?.before.tiers[HAIKU]).toMatchObject({ mergedChanges: 0 });
    expect(split?.after.tiers[HAIKU]).toMatchObject({ mergedChanges: 1 });
  });

  it("splits a report with no date bounds at all", () => {
    const split = buildReport(SPLIT_EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      splitAt: new Date(START + 1500 * 1000),
    }).sendBackTiersSplit;

    expect(split?.before.tiers[HAIKU]).toMatchObject({ mergedChanges: 1 });
    expect(split?.after.tiers[HAIKU]).toMatchObject({ mergedChanges: 1 });
  });
});
