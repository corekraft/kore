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

// Window: 1000 s to 2000 s after START. Writers launch before it, as the join reads them.
const WINDOW = {
  since: new Date(START + 1000 * 1000),
  until: new Date(START + 2000 * 1000),
};

/** A principles-review verdict as `review post` records it: the PR, the head in the label, the violation count. */
const verdict = (
  seconds: number,
  number: number,
  head: string,
  findings: number,
) =>
  atStart(seconds, "review.run", {
    number,
    label: `posted:${head}`,
    findings,
  });

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
  atStart(1, "pr.linked", { number: 12, agent: "h-writer" }),
  atStart(1, "pr.linked", { number: 14, agent: "s-writer" }),
  // PR 11 (Haiku): a failing verdict, no send-back and no send to the writer; merged on that head.
  verdict(1050, 11, "aaaaaaaa", 2),
  atStart(1100, "pr.merged", { number: 11 }),
  // PR 12 (Haiku): a clean verdict on one head, then a send-back on a later head with no verdict, then a send.
  verdict(1020, 12, "bbbbbbbb", 0),
  atStart(1100, "send-back", {
    number: 12,
    category: "scope",
    label: "scope @cccccc1",
  }),
  atStart(1150, "session.send", { agent: "h-writer", pane: "w1:p1" }),
  atStart(1200, "pr.merged", { number: 12 }),
  // PR 13: no writer link, no verdict.
  atStart(1300, "pr.merged", { number: 13 }),
  // PR 14 (Sonnet): two clean verdicts on the same head count the change once.
  verdict(1310, 14, "dddddddd", 0),
  verdict(1320, 14, "dddddddd", 0),
  atStart(1400, "pr.merged", { number: 14 }),
];

describe("flow report failed review rounds and review coverage by writer tier (#1050)", () => {
  it("reports a failing verdict with no send to the writer as a failed review round and not as rework, beside the rework it counts", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.reviewRounds.tiers[HAIKU]).toEqual({
      mergedChanges: 2,
      failedReviewRounds: 2,
      failedReviewRoundsPerMergedChange: 1,
      rework: 1,
      reworkPerMergedChange: 0.5,
      reviewedChanges: 1,
      reviewCoverage: 0.5,
    });
  });

  it("counts a change once however many verdicts it has, and a verdict only for the head it names", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.reviewRounds.tiers[SONNET]).toEqual({
      mergedChanges: 1,
      failedReviewRounds: 0,
      failedReviewRoundsPerMergedChange: 0,
      rework: 0,
      reworkPerMergedChange: 0,
      reviewedChanges: 1,
      reviewCoverage: 1,
    });
    // PR 12's only verdict is on an older head than its send-back names: it is not reviewed.
    expect(r.reviewRounds.tiers[HAIKU]?.reviewedChanges).toBe(1);
  });

  it("keeps a change with no writer link in the unlinked row and gives it no tier", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.reviewRounds.unlinked).toEqual({
      mergedChanges: 1,
      failedReviewRounds: 0,
      reviewedChanges: 0,
      reviewCoverage: 0,
    });
  });
});

describe("flow report failed review rounds and review coverage split at a date (#1050)", () => {
  it("splits the figures at a date, a change merged at the date on the after side, and holds nothing without one", () => {
    const split = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      splitAt: new Date(START + 1200 * 1000),
    });

    expect(split.reviewRoundsSplit?.at).toBe("2026-11-17T00:20:00.000Z");
    expect(split.reviewRoundsSplit?.before.tiers[HAIKU]).toEqual({
      mergedChanges: 1,
      failedReviewRounds: 2,
      failedReviewRoundsPerMergedChange: 2,
      rework: 1,
      reworkPerMergedChange: 1,
      reviewedChanges: 1,
      reviewCoverage: 1,
    });
    expect(split.reviewRoundsSplit?.after.tiers[HAIKU]).toEqual({
      mergedChanges: 1,
      failedReviewRounds: 0,
      failedReviewRoundsPerMergedChange: 0,
      rework: 0,
      reworkPerMergedChange: 0,
      reviewedChanges: 0,
      reviewCoverage: 0,
    });
    const plain = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });
    expect("reviewRoundsSplit" in plain).toBe(false);
  });

  it("reads no change merged outside the date bounds", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      since: new Date(START + 1250 * 1000),
      until: new Date(START + 2000 * 1000),
    });

    expect(r.reviewRounds.tiers[HAIKU]?.mergedChanges).toBe(0);
    expect(r.reviewRounds.tiers[HAIKU]?.reviewCoverage).toBeNull();
    expect(r.reviewRounds.tiers[SONNET]?.mergedChanges).toBe(1);
  });
});
