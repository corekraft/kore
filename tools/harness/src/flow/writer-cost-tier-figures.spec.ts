import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import {
  HAIKU,
  OPTIONS,
  SONNET,
  event,
  launch,
  linked,
  mergedAt,
} from "./writer-cost-support.js";
import { writerCost } from "./writer-cost.js";

const MINUTE = 60_000;
/** A span the minute-scaled fixture sits inside. */
const SPAN: [number, number] = [0, 100 * MINUTE];

const send = (ms: number, agent: string, pane: string) =>
  event(ms, "session.send", { agent, pane });
const sendBack = (ms: number, number: number) =>
  event(ms, "send-back", { number });
const ownerAction = (ms: number, number: number) =>
  event(ms, "owner.action", { number });

/** A token.split reading of one writer's cumulative request counts and first prompt. */
const split = (
  ms: number,
  agent: string,
  model: string,
  counts: { low: number; high: number; firstPrompt: number },
): LedgerEvent =>
  event(ms, "token.split", {
    agent,
    model,
    lowRequests: counts.low,
    highRequests: counts.high,
    firstPrompt: counts.firstPrompt,
    largestPrompt: counts.firstPrompt,
    lowInput: 0,
    lowCacheWrite5m: 0,
    lowCacheWrite1h: 0,
    lowCacheRead: 0,
    lowOutput: 0,
    highInput: 0,
    highCacheWrite5m: 0,
    highCacheWrite1h: 0,
    highCacheRead: 0,
    highOutput: 0,
  });

// Three merged changes link to the haiku writer and two to the sonnet writer, so each tier
// divides by its own count. One haiku send and one sonnet send follow a send-back each.
const TIERS_EVENTS = [
  launch(1 * MINUTE, "h-writer", "w1:p1", HAIKU),
  launch(1 * MINUTE, "s-writer", "w1:p2", SONNET),
  linked(2 * MINUTE, 100, "h-writer"),
  linked(2 * MINUTE, 101, "h-writer"),
  linked(2 * MINUTE, 102, "h-writer"),
  linked(2 * MINUTE, 103, "s-writer"),
  linked(2 * MINUTE, 104, "s-writer"),
  ...mergedAt(10 * MINUTE, 11 * MINUTE, 12 * MINUTE, 13 * MINUTE, 14 * MINUTE),
  sendBack(5 * MINUTE, 100),
  send(6 * MINUTE, "h-writer", "w1:p1"),
  sendBack(5 * MINUTE, 103),
  send(6 * MINUTE, "s-writer", "w1:p2"),
  // Haiku's change 100 has two sittings' worth of owner time six minutes apart: one sitting of six.
  ownerAction(3 * MINUTE, 100),
  ownerAction(9 * MINUTE, 100),
  ownerAction(3 * MINUTE, 999), // not a joined change
  // Sonnet's two changes share one sitting at minute three: one minute, over two changes.
  ownerAction(3 * MINUTE, 103),
  ownerAction(3 * MINUTE, 104),
  // Haiku: 6 requests of 100K or under and 2 over the step, first prompt 112K.
  split(8 * MINUTE, "h-writer", HAIKU, {
    low: 6,
    high: 2,
    firstPrompt: 112_000,
  }),
  // Sonnet: 4 requests, none over the step, first prompt 50K.
  split(8 * MINUTE, "s-writer", SONNET, {
    low: 4,
    high: 0,
    firstPrompt: 50_000,
  }),
];

/** A haiku writer launched at one minute, whose first request had the given prompt size. */
const promptedWriter = (i: number, prompt: number): LedgerEvent[] => [
  launch(1 * MINUTE, `p${i}-writer`, `w2:p${i}`, HAIKU),
  split(8 * MINUTE, `p${i}-writer`, HAIKU, {
    low: 1,
    high: 0,
    firstPrompt: prompt,
  }),
];

describe("writer cost by tier: rework, owner minutes, request share and prompt size", () => {
  it("prints each tier's rework, owner minutes, over-100K share and prompt size over its own merged changes", () => {
    const r = writerCost(TIERS_EVENTS, SPAN, OPTIONS);
    if (r.current.status !== "ok") {
      throw new Error("expected an ok figure");
    }
    expect(r.current.tiers[HAIKU]).toMatchObject({
      mergedChanges: 3,
      rework: 1,
      reworkPerMergedChange: 0.3333,
      ownerMinutes: 6,
      ownerMinutesPerMergedChange: 2,
      requests: 8,
      over100kShare: 0.25,
      firstPromptP50: 112_000,
      firstPromptP90: 112_000,
    });
    expect(r.current.tiers[SONNET]).toMatchObject({
      mergedChanges: 2,
      rework: 1,
      reworkPerMergedChange: 0.5,
      ownerMinutes: 1,
      ownerMinutesPerMergedChange: 0.5,
      requests: 4,
      over100kShare: 0,
      firstPromptP50: 50_000,
      firstPromptP90: 50_000,
    });
  });

  it("reads a tier with no joined change as not read, never as zero, while its counts stay zero", () => {
    const r = writerCost(TIERS_EVENTS, SPAN, OPTIONS);
    if (r.current.status !== "ok") {
      throw new Error("expected an ok figure");
    }
    expect(r.current.tiers["claude-opus-5-5"]).toMatchObject({
      sessions: 0,
      rework: 0,
      reworkPerMergedChange: null,
      ownerMinutes: 0,
      ownerMinutesPerMergedChange: null,
      requests: 0,
      over100kShare: null,
      firstPromptP50: null,
      firstPromptP90: null,
    });
  });

  it("reads every new tier figure as insufficient, not zero, when the span has too few merged changes", () => {
    const r = writerCost(
      TIERS_EVENTS.filter((e) => e.kind !== "pr.merged"),
      SPAN,
      OPTIONS,
    );
    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 0,
      needed: 5,
    });
  });
});

describe("writer cost by tier: the first-request prompt's percentiles", () => {
  it("gives the 50th and 90th percentile of the tier's first-request prompts by nearest rank", () => {
    const events = [
      ...[100_000, 200_000, 300_000, 400_000, 500_000].flatMap((prompt, i) =>
        promptedWriter(i, prompt),
      ),
      ...mergedAt(
        10 * MINUTE,
        11 * MINUTE,
        12 * MINUTE,
        13 * MINUTE,
        14 * MINUTE,
      ),
    ];
    const r = writerCost(events, SPAN, OPTIONS);
    if (r.current.status !== "ok") {
      throw new Error("expected an ok figure");
    }
    expect(r.current.tiers[HAIKU]).toMatchObject({
      sessions: 5,
      firstPromptP50: 300_000,
      firstPromptP90: 500_000,
    });
  });
});
