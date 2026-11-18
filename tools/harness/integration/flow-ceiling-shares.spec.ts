import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";
import type { LedgerEvent } from "../src/ledger/index.js";

const ASOF = new Date(T0 + 86_400_000);
const MILLION = 1_000_000;
const CEILING = 100 * MILLION;
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const RATE = "of the weekly ceiling";
const SIZE = "of one week's ceiling";

/** A session's cumulative reading of input tokens on a model (Haiku weighs 1 a token, Sonnet 20). */
const split = (seconds: number, agent: string, model: string, input: number) =>
  at(seconds, "token.split", {
    source: "claude",
    agent,
    session: agent,
    model,
    lowInput: input,
  });

const launch = (
  seconds: number,
  agent: string,
  role: string,
  tier: string,
  fields: Partial<LedgerEvent> = {},
) =>
  at(seconds, "session.launch", {
    source: "herdr",
    agent,
    pane: `w1:${agent}`,
    role,
    tier,
    ...fields,
  });

const link = (agent: string, number: number, idea: string) =>
  at(8, "pr.linked", {
    source: "herdr",
    number,
    session: agent,
    agent,
    idea,
  });

// Two roles: two Sonnet writers (1M and 2M input = 20M and 40M plan-weighted tokens) and one Haiku
// judge (4M). Two merged changes, one per writer, the judge's 4M shared equally: 20M + 2M = 22M
// and 40M + 2M = 42M. One idea, #7, stamped on the first writer: 20M.
const EVENTS: LedgerEvent[] = [
  launch(0, "a-writer", "writer", SONNET, { idea: "#7" }),
  launch(1, "b-writer", "writer", SONNET),
  launch(2, "j-judge", "judge", HAIKU),
  split(10, "a-writer", SONNET, MILLION),
  split(10, "b-writer", SONNET, 2 * MILLION),
  split(10, "j-judge", HAIKU, 4 * MILLION),
  link("a-writer", 9, "#7"),
  link("b-writer", 10, "none"),
  at(20, "pr.opened", { source: "github", number: 9 }),
  at(21, "pr.opened", { source: "github", number: 10 }),
  at(600, "pr.merged", { source: "github", number: 9 }),
  at(1200, "pr.merged", { source: "github", number: 10 }),
];

function report(
  ceiling: number | undefined,
  minimum = 1,
  events = EVENTS,
): FlowReport["costWaiting"]["ceilingShares"] {
  return buildReport(events, {
    asOf: ASOF,
    minCompletedIdeas: 1,
    cost: { minMergedChanges: minimum },
    weeklyTokenCeiling: ceiling,
  }).costWaiting.ceilingShares;
}

describe("flow report: shares of the weekly ceiling from ledger events", () => {
  it("reads each role as a rate over the trailing week: the writers 60M and the judge 4M of 100M, the median of two rows their mean", () => {
    const { agents } = report(CEILING);

    expect(agents).toMatchObject({
      label: RATE,
      status: "measured",
      days: 7,
      total: 0.64,
      median: 0.32,
      p90: 0.6,
    });
    expect(agents.rows.writer).toEqual({
      label: RATE,
      status: "measured",
      share: 0.6,
    });
    expect(agents.rows.judge).toEqual({
      label: RATE,
      status: "measured",
      share: 0.04,
    });
  });

  it("reads each merged change as a size over one week's ceiling, with its launch-to-merge span", () => {
    const { mergedChanges } = report(CEILING);

    expect(mergedChanges.rows).toEqual([
      {
        number: 9,
        share: {
          label: SIZE,
          status: "measured",
          share: 0.22,
          spanSeconds: 600,
        },
      },
      {
        number: 10,
        share: {
          label: SIZE,
          status: "measured",
          share: 0.42,
          spanSeconds: 1199,
        },
      },
    ]);
    expect(mergedChanges).toMatchObject({
      total: 0.64,
      median: 0.32,
      p90: 0.42,
    });
  });

  it("reads the idea as a size over one week's ceiling, with the span from its first event to its last", () => {
    const { ideas } = report(CEILING);

    expect(ideas.rows).toEqual([
      {
        idea: "#7",
        share: { label: SIZE, status: "measured", share: 0.2, spanSeconds: 8 },
      },
    ]);
  });
});

describe("flow report: shares of the weekly ceiling are never a zero", () => {
  it("reads not set at every level when the config names no ceiling", () => {
    const shares = report(undefined);

    expect(shares.ceiling).toBe("not set");
    expect(shares.agents.rows.writer).toMatchObject({ share: "not set" });
    expect(shares.agents).toMatchObject({ total: "not set" });
    expect(shares.mergedChanges.rows[0]?.share).toMatchObject({
      share: "not set",
    });
    expect(shares.ideas).toMatchObject({ total: "not set" });
  });

  it("reads a level below the minimum count as insufficient, not a zero share", () => {
    const shares = report(CEILING, 3);

    expect(shares.agents.rows.writer).toEqual({
      label: RATE,
      status: "insufficient",
      units: 2,
      needed: 3,
    });
    expect(shares.mergedChanges).toMatchObject({
      status: "insufficient",
      units: 2,
      needed: 3,
    });
    expect(shares.ideas).toMatchObject({ status: "insufficient" });
  });

  it("names a model the plan does not weight instead of reading its tokens as zero", () => {
    const shares = report(CEILING, 1, [
      ...EVENTS,
      launch(3, "m-writer", "writer", "claude-mystery-9"),
      split(10, "m-writer", "claude-mystery-9", MILLION),
    ]);

    expect(shares.agents.rows.writer).toEqual({
      label: RATE,
      status: "insufficient weights",
      models: ["claude-mystery-9"],
    });
    expect(shares.agents).toMatchObject({
      status: "insufficient weights",
      models: ["claude-mystery-9"],
    });
  });
});
