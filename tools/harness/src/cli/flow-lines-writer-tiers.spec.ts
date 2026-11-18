import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { writerTierLines } from "./flow-lines.js";

type WriterCost = FlowReport["writerCost"];
type Tier = Extract<WriterCost["current"], { status: "ok" }>["tiers"][string];

/** A tier with no session, no change and nothing read, except the fields a test sets. */
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

const HAIKU_READ = tier({
  sessions: 1,
  mergedChanges: 3,
  blockedShare: 0.25,
  followUpsPerSession: 2,
  rework: 1,
  reworkPerMergedChange: 0.3333,
  ownerMinutes: 6,
  ownerMinutesPerMergedChange: 2,
  requests: 8,
  over100kShare: 0.25,
  firstPromptP50: 112_000,
  firstPromptP90: 112_000,
});

const ok = (tiers: Record<string, Tier>): WriterCost["current"] => ({
  status: "ok",
  merged: 5,
  unjoinable: 0,
  relaunchLimit: "relaunch",
  orchestrate: {
    weightedTokens: 0,
    perMergedChange: 0,
    model: "claude-opus-5-5",
    basis: "none",
    recordedModels: [],
    assumedTokens: 0,
    dollars: 0,
    dollarsPerMergedChange: 0,
  },
  judge: { dollars: 0, dollarsPerMergedChange: 0 },
  unmergedWriterSessions: 0,
  tiers,
});

describe("writerTierLines: each tier's rework, owner time, request share and prompt size (#1009)", () => {
  it("prints each tier on its own line, with every figure it reads and no zero for one it does not", () => {
    expect(
      writerTierLines({
        current: ok({
          "claude-haiku-5-5": HAIKU_READ,
          "claude-sonnet-5-5": tier({}),
        }),
      }),
    ).toEqual([
      "Writer tier claude-haiku-5-5: 1 writer session; blocked share 0.25; follow-ups per session 2; rework per merged change 0.3333; owner minutes per merged change 2; over-100K share 0.25 of 8 requests; first-request prompt median 112000 and p90 112000",
      "Writer tier claude-sonnet-5-5: no writer session",
    ]);
  });

  it("reads a figure that is null as not read, never as zero", () => {
    expect(
      writerTierLines({
        current: ok({
          "claude-haiku-5-5": tier({
            sessions: 1,
            reworkPerMergedChange: null,
            over100kShare: null,
          }),
        }),
      }),
    ).toEqual([
      "Writer tier claude-haiku-5-5: 1 writer session; blocked share not read; follow-ups per session not read; rework per merged change not read; owner minutes per merged change not read; over-100K share not read of 0 requests; first-request prompt median not read and p90 not read",
    ]);
  });

  it("says the tier figures are not read, with the changes it has, below the minimum merged changes", () => {
    expect(
      writerTierLines({
        current: {
          status: "insufficient merged changes",
          merged: 2,
          needed: 5,
        },
      }),
    ).toEqual([
      "Writer tiers beyond cost: not read, 2 merged changes in this range (5 needed)",
    ]);
  });
});
