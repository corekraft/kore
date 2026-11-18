import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { writerDollarsLines } from "./flow-lines.js";

type WriterCost = FlowReport["writerCost"];
type Tier = WriterCost["current"] extends infer F
  ? F extends { status: "ok"; tiers: Record<string, infer T> }
    ? T
    : never
  : never;

const DOLLARS = {
  writer: 5,
  reviewer: 1.3333,
  judge: 0.8,
  orchestrate: 0.4,
  allIn: 7.5333,
  median: 4.2,
};

/** A tier with no session, no change and no dollars, except the fields a test sets. */
const tier = (over: Partial<Tier>): Tier => ({
  sessions: 0,
  weightedTokens: 0,
  perMergedChange: 0,
  mergedChanges: 0,
  perMergedChangeByTier: null,
  followUpsPerSession: null,
  finished: 0,
  blocked: 0,
  blockedShare: null,
  perMergedChangeDollars: null,
  rework: 0,
  reworkPerMergedChange: null,
  ownerMinutes: 0,
  ownerMinutesPerMergedChange: null,
  requests: 0,
  over100kShare: null,
  firstPromptP50: null,
  firstPromptP90: null,
  ...over,
});

const RELAUNCH =
  "A relaunch on a new session with no idea stamp cannot be joined to the first launch: its merged change takes the relaunch's tier, not the first launch's.";

const OK_CURRENT: WriterCost["current"] = {
  status: "ok",
  merged: 5,
  unjoinable: 1,
  relaunchLimit: RELAUNCH,
  orchestrate: {
    weightedTokens: 0,
    perMergedChange: 0,
    model: "claude-opus-5-5",
    dollars: 2,
    dollarsPerMergedChange: 0.4,
  },
  judge: { dollars: 4, dollarsPerMergedChange: 0.8 },
  unmergedWriterSessions: 1,
  tiers: {
    "claude-haiku-5-5": tier({
      mergedChanges: 3,
      perMergedChangeDollars: DOLLARS,
    }),
    "claude-sonnet-5-5": tier({ mergedChanges: 0 }),
  },
};

const OK_TRAILING: WriterCost["trailingAverage"] = {
  status: "ok",
  merged: 5,
  unjoinable: 0,
  relaunchLimit: RELAUNCH,
  orchestrate: {
    weightedTokens: 0,
    perMergedChange: 0,
    model: "claude-opus-5-5",
    dollars: 0,
    dollarsPerMergedChange: 0,
  },
  judge: { dollars: 0, dollarsPerMergedChange: 0 },
  unmergedWriterSessions: 0,
  tiers: {
    "claude-haiku-5-5": tier({
      mergedChanges: 2,
      perMergedChangeDollars: { ...DOLLARS, allIn: 6.1, median: 6.1 },
    }),
  },
};

const report = (
  current: WriterCost["current"],
  trailingAverage: WriterCost["trailingAverage"],
): FlowReport["writerCost"] => ({
  pricesAsOf: "2026-11-17",
  trailingDays: 7,
  minMergedChanges: 5,
  current,
  trailingAverage,
});

describe("writerDollarsLines: all-in cost per merged change by first-launch tier (#1008)", () => {
  it("prints each tier's mean with its parts and its median, and names the assumed orchestrating model", () => {
    expect(writerDollarsLines(report(OK_CURRENT, OK_TRAILING))).toEqual([
      "All-in cost per merged change by first-launch tier (prices read 2026-11-17): claude-haiku-5-5 $7.5333 mean over 3 merged changes, median $4.2 (writer $5, reviewer $1.3333, judge $0.8, orchestrate $0.4); 1 unjoinable; 1 writer session with no merged change, left out",
      "Orchestrating dollars are priced at claude-opus-5-5, an assumed main-session model, not a recorded one; the parts are means and do not sum to the median.",
      "All-in cost per merged change, trailing average over the 7 days before: claude-haiku-5-5 $6.1 mean",
    ]);
  });

  it("reads the window as not read below the minimum merged changes, never as zero", () => {
    expect(
      writerDollarsLines(
        report(
          { status: "insufficient merged changes", merged: 2, needed: 5 },
          { status: "insufficient merged changes", merged: 0, needed: 5 },
        ),
      ),
    ).toEqual([
      "All-in cost per merged change: not read, 2 merged changes in this range (5 needed)",
      "All-in cost per merged change, trailing average: no average: 0 merged changes in the trailing 7 days (5 needed)",
    ]);
  });

  it("says no tier is read when no merged change joined to a tier, rather than printing a zero", () => {
    const none: WriterCost["current"] = {
      ...OK_CURRENT,
      tiers: { "claude-haiku-5-5": tier({ mergedChanges: 0 }) },
    };
    expect(writerDollarsLines(report(none, OK_TRAILING))[0]).toBe(
      "All-in cost per merged change by first-launch tier (prices read 2026-11-17): no tier joined to a merged change, not read; 1 unjoinable; 1 writer session with no merged change, left out",
    );
  });

  it("names the unpriced model a tier is not read for, rather than printing a dollar figure or a zero", () => {
    const unpriced: WriterCost["current"] = {
      ...OK_CURRENT,
      tiers: {
        "claude-haiku-5-5": tier({
          mergedChanges: 3,
          perMergedChangeDollars: {
            status: "insufficient prices",
            models: ["claude-sonnet-5-5"],
          },
        }),
      },
    };
    expect(writerDollarsLines(report(unpriced, OK_TRAILING))[0]).toBe(
      "All-in cost per merged change by first-launch tier (prices read 2026-11-17): claude-haiku-5-5 not read: no price for claude-sonnet-5-5; 1 unjoinable; 1 writer session with no merged change, left out",
    );
  });
});
