import { describe, expect, it } from "vitest";
import {
  HAIKU,
  NO_JUDGE,
  NO_ORCHESTRATE,
  OPTIONS,
  RELAUNCH_LIMIT,
  SONNET,
  WINDOW,
  ZERO_TIER,
  ZERO_DOLLARS,
  ZERO_TIERS,
  ideaLaunch,
  launch,
  linked,
  mergedAt,
  writerUsage,
} from "./writer-cost-support.js";
import { writerCost } from "./writer-cost.js";

// Five merged changes: three link to a haiku writer and two to a sonnet writer, so each tier's
// per-merged figure divides by its own count (three and two), not by all five.
const TWO_TIER_EVENTS = [
  launch(100, "h-writer", "w1:p1", HAIKU),
  writerUsage(1100, "h-writer", "w1:p1", 300),
  launch(150, "s-writer", "w1:p2", SONNET),
  writerUsage(1200, "s-writer", "w1:p2", 20),
  linked(1300, 100, "h-writer"),
  linked(1310, 101, "h-writer"),
  linked(1320, 102, "h-writer"),
  linked(1330, 103, "s-writer"),
  linked(1340, 104, "s-writer"),
  ...mergedAt(1400, 1500, 1600, 1700, 1800),
];

describe("writer cost: each tier's figure over its own merged changes", () => {
  it("divides each tier's weighted tokens by that tier's own merged changes, and leaves the all-changes figure as it was", () => {
    const r = writerCost(TWO_TIER_EVENTS, WINDOW, OPTIONS);

    expect(r.current).toEqual({
      status: "ok",
      merged: 5,
      unjoinable: 0,
      relaunchLimit: RELAUNCH_LIMIT,
      orchestrate: NO_ORCHESTRATE,
      judge: NO_JUDGE,
      unmergedWriterSessions: 0,
      tiers: {
        ...ZERO_TIERS,
        "claude-haiku-5-5": {
          ...ZERO_TIER,
          sessions: 1,
          weightedTokens: 300,
          perMergedChangeByTier: 100,
          mergedChanges: 3,
          followUpsPerSession: 0,
          perMergedChangeDollars: ZERO_DOLLARS,
          reworkPerMergedChange: 0,
          ownerMinutesPerMergedChange: 0,
        },
        "claude-sonnet-5-5": {
          ...ZERO_TIER,
          sessions: 1,
          weightedTokens: 400,
          perMergedChangeByTier: 200,
          mergedChanges: 2,
          followUpsPerSession: 0,
          perMergedChangeDollars: ZERO_DOLLARS,
          reworkPerMergedChange: 0,
          ownerMinutesPerMergedChange: 0,
        },
      },
    });
  });
});

describe("writer cost: a merged change with no tier", () => {
  it("counts a merged change with no link event as unjoinable, in no tier, and never as a zero", () => {
    // Merged change 100 has no link; the other four link, so exactly one is unjoinable.
    const r = writerCost(
      [
        launch(100, "h-writer", "w1:p1", HAIKU),
        writerUsage(1100, "h-writer", "w1:p1", 300),
        launch(150, "s-writer", "w1:p2", SONNET),
        linked(1510, 101, "h-writer"),
        linked(1520, 102, "h-writer"),
        linked(1530, 103, "s-writer"),
        linked(1540, 104, "s-writer"),
        ...mergedAt(1400, 1500, 1600, 1700, 1800),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({
      status: "ok",
      merged: 5,
      unjoinable: 1,
    });
    expect(r.current).toHaveProperty("tiers.claude-haiku-5-5.mergedChanges", 2);
    expect(r.current).toHaveProperty(
      "tiers.claude-sonnet-5-5.mergedChanges",
      2,
    );
  });

  it("counts a merged change whose link names a session with no priced launch as unjoinable, in no tier", () => {
    const r = writerCost(
      [
        launch(150, "s-writer", "w1:p2", SONNET),
        launch(160, "c-writer", "w1:p3", "claude-mystery-1"),
        linked(1410, 100, "c-writer"),
        linked(1420, 101, "s-writer"),
        linked(1430, 102, "s-writer"),
        linked(1440, 103, "s-writer"),
        linked(1450, 104, "s-writer"),
        ...mergedAt(1400, 1500, 1600, 1700, 1800),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({ merged: 5, unjoinable: 1 });
    expect(r.current).toHaveProperty(
      "tiers.claude-sonnet-5-5.mergedChanges",
      4,
    );
  });
});

describe("writer cost: a pull request opened before the link event", () => {
  it("counts a merged change whose pull request has no link event as unjoinable, even when its idea has a launch", () => {
    const r = writerCost(
      [
        ideaLaunch(1100, "h-writer", "w1:p1", HAIKU, "#1007"),
        ...mergedAt(1400, 1500, 1600, 1700, 1800),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      merged: 5,
      unjoinable: 5,
      relaunchLimit: RELAUNCH_LIMIT,
      orchestrate: NO_ORCHESTRATE,
      judge: NO_JUDGE,
      unmergedWriterSessions: 0,
      tiers: {
        ...ZERO_TIERS,
        "claude-haiku-5-5": {
          ...ZERO_TIER,
          sessions: 1,
          followUpsPerSession: 0,
        },
      },
    });
  });
});

describe("writer cost: a respawn under one idea", () => {
  it("joins a merged change to the tier of the earliest launch with the idea its linked session carries", () => {
    const r = writerCost(
      [
        ideaLaunch(1100, "h-writer", "w1:p1", HAIKU, "#1007"),
        ideaLaunch(1150, "s-writer", "w1:p2", SONNET, "#1007"),
        linked(1400, 100, "s-writer"),
        ...mergedAt(1400, 1500, 1600, 1700, 1800),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      merged: 5,
      unjoinable: 4,
      relaunchLimit: RELAUNCH_LIMIT,
      orchestrate: NO_ORCHESTRATE,
      judge: NO_JUDGE,
      unmergedWriterSessions: 0,
      tiers: {
        ...ZERO_TIERS,
        "claude-haiku-5-5": {
          ...ZERO_TIER,
          sessions: 1,
          mergedChanges: 1,
          perMergedChangeByTier: 0,
          perMergedChangeDollars: ZERO_DOLLARS,
          followUpsPerSession: 0,
          reworkPerMergedChange: 0,
          ownerMinutesPerMergedChange: 0,
        },
        "claude-sonnet-5-5": {
          ...ZERO_TIER,
          sessions: 1,
          followUpsPerSession: 0,
        },
      },
    });
  });
});
