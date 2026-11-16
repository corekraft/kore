import { describe, expect, it } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { writerCost } from "./writer-cost.js";

const WINDOW: [number, number] = [1000, 2000];
const ASOF = new Date(10_000);
const OPTIONS = { trailingDays: 7, minMergedChanges: 5, asOf: ASOF };

/** An event at a time in milliseconds, with its occurredAt set to that time. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "herdr",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

/** A writer launched into a pane on a model tier. */
const launch = (ms: number, agent: string, pane: string, tier: string) =>
  event(ms, "session.launch", { agent, pane, role: "writer", tier });

/** A cumulative token reading for a writer session in its pane. */
const writerUsage = (ms: number, agent: string, pane: string, tokens: number) =>
  event(ms, "token.usage", { agent, pane, tokens, source: "claude" });

const mergedAt = (...times: number[]) =>
  times.map((ms, i) => event(ms, "pr.merged", { number: 100 + i }));

const ZERO_TIER = {
  sessions: 0,
  weightedTokens: 0,
  perMergedChange: 0,
  followUpsPerSession: null,
  finished: 0,
  blocked: 0,
  blockedShare: null,
};

const ZERO_TIERS = {
  "claude-fable-5-2": ZERO_TIER,
  "claude-opus-5-5": ZERO_TIER,
  "claude-sonnet-5-5": ZERO_TIER,
  "claude-haiku-5-5": ZERO_TIER,
};

const NO_ORCHESTRATE = { weightedTokens: 0, perMergedChange: 0 };

// Two haiku writers (one a respawn) and one sonnet writer, plus the main session.
const PRICED_EVENTS = [
  launch(100, "a-writer", "w1:p1", "claude-haiku-5-5"),
  writerUsage(1100, "a-writer", "w1:p1", 40),
  writerUsage(1500, "a-writer", "w1:p1", 100),
  launch(150, "b-writer", "w1:p2", "claude-sonnet-5-5"),
  writerUsage(1200, "b-writer", "w1:p2", 10),
  launch(1450, "a2-writer", "w1:p3", "claude-haiku-5-5"),
  writerUsage(1460, "a2-writer", "w1:p3", 30),
  // The main session has no agent: it orchestrates, and is priced at the main-session model.
  event(1300, "token.usage", {
    session: "main-s",
    tokens: 25,
    source: "claude",
  }),
  ...mergedAt(1400, 1500, 1600, 1700, 1800),
];

const PRICED_CURRENT = {
  status: "ok",
  merged: 5,
  orchestrate: { weightedTokens: 1000, perMergedChange: 200 },
  tiers: {
    ...ZERO_TIERS,
    "claude-haiku-5-5": {
      ...ZERO_TIER,
      sessions: 2,
      weightedTokens: 130,
      perMergedChange: 26,
      followUpsPerSession: 0,
    },
    "claude-sonnet-5-5": {
      ...ZERO_TIER,
      sessions: 1,
      weightedTokens: 200,
      perMergedChange: 40,
      followUpsPerSession: 0,
    },
  },
};

describe("writer cost: tokens priced by launch tier", () => {
  it("prices each writer's window tokens by its launch tier, counting a respawn and the main session's tokens", () => {
    const r = writerCost(PRICED_EVENTS, WINDOW, OPTIONS);

    expect(r).toEqual({
      pricesAsOf: "2026-11-16",
      trailingDays: 7,
      minMergedChanges: 5,
      current: PRICED_CURRENT,
      trailingAverage: {
        status: "insufficient merged changes",
        merged: 0,
        needed: 5,
      },
    });
  });
});

// Follow-ups to writer panes count; a send outside the window, or to a pane no writer launched, does not.
const FOLLOW_UP_EVENTS = [
  launch(1100, "a-writer", "w1:p1", "claude-haiku-5-5"),
  launch(1150, "b-writer", "w1:p2", "claude-sonnet-5-5"),
  event(1250, "session.send", { pane: "w1:p1", senderRole: "judge" }),
  event(1260, "session.send", { pane: "w1:p1" }),
  event(1270, "session.send", { pane: "w1:p2" }),
  event(1280, "session.send", { pane: "w1:p9" }),
  event(500, "session.send", { pane: "w1:p1" }),
  // A writer whose latest stop says blocked is blocked; one that says done is not.
  event(1350, "session.result", { agent: "a-writer", result: "blocked" }),
  event(1360, "session.result", { agent: "b-writer", result: "done" }),
  ...mergedAt(1400, 1500, 1600, 1700, 1800),
];

describe("writer cost: follow-ups and blocked share beside price", () => {
  it("reports follow-ups per writer session and the blocked share beside each tier's price", () => {
    const r = writerCost(FOLLOW_UP_EVENTS, WINDOW, OPTIONS);

    expect(r.current).toEqual({
      status: "ok",
      merged: 5,
      orchestrate: NO_ORCHESTRATE,
      tiers: {
        ...ZERO_TIERS,
        "claude-haiku-5-5": {
          ...ZERO_TIER,
          sessions: 1,
          followUpsPerSession: 2,
          finished: 1,
          blocked: 1,
          blockedShare: 1,
        },
        "claude-sonnet-5-5": {
          ...ZERO_TIER,
          sessions: 1,
          followUpsPerSession: 1,
          finished: 1,
          blocked: 0,
          blockedShare: 0,
        },
      },
    });
  });
});

describe("writer cost: what is left out", () => {
  it("leaves a writer on a model the price table does not know out of every tier, not counted as a zero", () => {
    const r = writerCost(
      [
        launch(100, "c-writer", "w1:p3", "claude-mystery-1"),
        writerUsage(1100, "c-writer", "w1:p3", 500),
        ...mergedAt(1400, 1500, 1600, 1700, 1800),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      merged: 5,
      orchestrate: NO_ORCHESTRATE,
      tiers: ZERO_TIERS,
    });
  });
});

describe("writer cost: a thin window", () => {
  it("reads no tier figure below the minimum merged changes, so a thin window is never read", () => {
    const r = writerCost(
      [
        launch(100, "a-writer", "w1:p1", "claude-haiku-5-5"),
        writerUsage(1100, "a-writer", "w1:p1", 40),
        ...mergedAt(1400, 1500, 1600, 1700),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 4,
      needed: 5,
    });
  });
});
