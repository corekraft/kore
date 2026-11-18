import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import type { ModelPrice } from "./writer-prices.js";
import { costWaitingIn } from "./cost-waiting.js";

const HAIKU = "claude-haiku-5-5";
const MILLION = 1_000_000;

// A fixture price table, so the figures below do not move with the published table: input at one
// dollar per million tokens, output at five, nothing else.
const PRICES: Readonly<Record<string, ModelPrice>> = {
  [HAIKU]: {
    inputPerMTok: 1,
    cacheWrite5mPerMTok: 0,
    cacheWrite1hPerMTok: 0,
    cacheReadPerMTok: 0,
    outputPerMTok: 5,
  },
};

const WINDOW: [number, number] = [
  Date.parse("2026-11-18T00:00:00Z"),
  Date.parse("2026-11-19T00:00:00Z"),
];

/** A time in the window, by minutes after 10:00 UTC on the window's first day. */
const at = (minute: number) =>
  new Date(Date.parse("2026-11-18T10:00:00Z") + minute * 60_000).toISOString();

/** A cumulative token reading of one session's model, as the stop hook writes it. */
const split = (
  agent: string,
  minute: number,
  counts: Partial<LedgerEvent>,
  idea?: string,
) =>
  ({
    kind: "token.split",
    occurredAt: at(minute),
    agent,
    model: HAIKU,
    ...(idea === undefined ? {} : { idea }),
    ...counts,
  }) as LedgerEvent;

const OPTIONS = { prices: PRICES, minimum: 1 };

describe("cost and waiting per agent: dollars and tokens by role", () => {
  it("prices each role's session in the window at the table and totals its tokens", () => {
    const events: LedgerEvent[] = [
      // Writer: 2M input and 1M output, so 2 x $1 + 1 x $5 = $7 over 3M tokens.
      split("idea-7-writer", 0, { lowInput: 2 * MILLION, lowOutput: MILLION }),
      // Judge: 1M input, so $1 over 1M tokens.
      split("idea-7-judge", 5, { lowInput: MILLION }),
    ];

    const figures = costWaitingIn(events, WINDOW, OPTIONS);

    expect(figures.agents.writer).toEqual({
      status: "measured",
      sessions: 1,
      dollars: { total: 7, median: 7, p90: 7 },
      tokens: { total: 3 * MILLION, median: 3 * MILLION, p90: 3 * MILLION },
      activeSeconds: { total: 0, median: 0, p90: 0 },
      waitingSeconds: { total: 0, median: 0, p90: 0 },
      ceilingShare: "not set",
    });
    expect(figures.agents.judge).toEqual({
      status: "measured",
      sessions: 1,
      dollars: { total: 1, median: 1, p90: 1 },
      tokens: { total: MILLION, median: MILLION, p90: MILLION },
      activeSeconds: { total: 0, median: 0, p90: 0 },
      waitingSeconds: { total: 0, median: 0, p90: 0 },
      ceilingShare: "not set",
    });
  });
});

describe("cost and waiting per agent: time, ceiling and minimum", () => {
  it("reads each role's active and waiting seconds from its sessions' own state events, with median and p90", () => {
    const state = (kind: string, minute: number) =>
      ({ kind, occurredAt: at(minute), agent: "idea-7-writer" }) as LedgerEvent;
    const events: LedgerEvent[] = [
      state("session.start", 0),
      split("idea-7-writer", 5, { lowInput: MILLION }),
      // Active 0 to 10 minutes, waiting on a person 10 to 20, active 20 to 30, then the session stops.
      state("pane.waiting", 10),
      state("pane.busy", 20),
      state("session.stop", 30),
    ];

    const figures = costWaitingIn(events, WINDOW, OPTIONS);

    expect(figures.agents.writer).toMatchObject({
      status: "measured",
      activeSeconds: { total: 1200, median: 1200, p90: 1200 },
      waitingSeconds: { total: 600, median: 600, p90: 600 },
    });
  });

  it("reads a role with fewer sessions than the minimum as insufficient, with the count it had, never as zero", () => {
    const figures = costWaitingIn(
      [split("idea-7-writer", 0, { lowInput: MILLION })],
      WINDOW,
      { prices: PRICES, minimum: 2 },
    );

    expect(figures.agents.writer).toEqual({
      status: "insufficient",
      sessions: 1,
      needed: 2,
    });
  });

  it("takes the median and the nearest-rank 90th percentile of the sessions' dollars", () => {
    // Three writer sessions at $1, $2 and $10: median 2, 90th percentile the largest of three.
    const figures = costWaitingIn(
      [
        split("idea-1-writer", 0, { lowInput: MILLION }),
        split("idea-2-writer", 1, { lowInput: 2 * MILLION }),
        split("idea-3-writer", 2, { lowInput: 10 * MILLION }),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(figures.agents.writer).toMatchObject({
      status: "measured",
      sessions: 3,
      dollars: { total: 13, median: 2, p90: 10 },
    });
  });

  it("reads a window's tokens as a share of the weekly ceiling in plan-weighted tokens, and says not set without one", () => {
    // Haiku is the baseline, so its low step weighs 1 per token: 3M tokens are 3M plan-weighted tokens.
    const events = [split("idea-7-writer", 0, { lowInput: 3 * MILLION })];

    const set = costWaitingIn(events, WINDOW, {
      ...OPTIONS,
      weeklyTokenCeiling: 30 * MILLION,
    });
    const unset = costWaitingIn(events, WINDOW, OPTIONS);

    expect(set.agents.writer).toMatchObject({
      status: "measured",
      tokens: { total: 3 * MILLION },
      ceilingShare: 0.1,
    });
    expect(unset.agents.writer).toMatchObject({
      status: "measured",
      activeSeconds: { total: 0, median: 0, p90: 0 },
      waitingSeconds: { total: 0, median: 0, p90: 0 },
      ceilingShare: "not set",
    });
  });
});

describe("cost and waiting per idea: dollars, tokens and lead time", () => {
  it("sums the dollars and tokens of the sessions stamped with the idea, and reads its lead time to its outcome", () => {
    const ideaEvents: LedgerEvent[] = [
      {
        kind: "session.launch",
        occurredAt: at(0),
        agent: "idea-7-writer",
        idea: "7",
        role: "writer",
        tier: HAIKU,
      } as LedgerEvent,
      split(
        "idea-7-writer",
        1,
        { lowInput: 2 * MILLION, lowOutput: MILLION },
        "7",
      ),
      split("idea-7-judge", 5, { lowInput: MILLION }, "7"),
      // A session stamped with another idea is left out of idea 7.
      split("idea-8-writer", 6, { lowInput: 5 * MILLION }, "8"),
      { kind: "issue.closed", occurredAt: at(60), idea: "7" } as LedgerEvent,
    ];

    const figures = costWaitingIn(ideaEvents, WINDOW, OPTIONS);

    expect(figures.ideas).toEqual([
      {
        idea: "7",
        dollars: 8,
        tokens: 4 * MILLION,
        leadTimeSeconds: 3600,
        outcome: "closed",
      },
      {
        idea: "8",
        dollars: 5,
        tokens: 5 * MILLION,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
  });
});

describe("cost and waiting: a model the price table does not price", () => {
  it("reads the role as insufficient prices that name the model, never as a zero", () => {
    const figures = costWaitingIn(
      [split("idea-7-writer", 0, { lowInput: MILLION })].map((e) => ({
        ...e,
        model: "claude-opus-5-5",
      })),
      WINDOW,
      OPTIONS,
    );

    expect(figures.agents.writer).toEqual({
      status: "insufficient prices",
      models: ["claude-opus-5-5"],
    });
  });
});

describe("cost and waiting per merged pull request", () => {
  it("prices each merged change all-in, with its time from the first writer launch and its wait from opening", () => {
    const events: LedgerEvent[] = [
      // Pull request 100: writer started at 10:00, opened at 10:05, linked, merged at 10:30.
      {
        kind: "session.launch",
        occurredAt: at(0),
        agent: "idea-7-writer",
        idea: "7",
        role: "writer",
        tier: HAIKU,
      } as LedgerEvent,
      { kind: "pr.opened", occurredAt: at(5), number: 100 } as LedgerEvent,
      {
        kind: "pr.linked",
        occurredAt: at(2),
        number: 100,
        agent: "idea-7-writer",
      } as LedgerEvent,
      split("idea-7-writer", 1, { lowInput: 2 * MILLION, lowOutput: MILLION }),
      split("pr100-reviewer", 20, { lowInput: MILLION }),
      { kind: "pr.merged", occurredAt: at(30), number: 100 } as LedgerEvent,
      // Pull request 101: writer started at 10:40, opened at 10:42, merged at 10:50, no reviewer.
      {
        kind: "session.launch",
        occurredAt: at(40),
        agent: "idea-8-writer",
        idea: "8",
        role: "writer",
        tier: HAIKU,
      } as LedgerEvent,
      { kind: "pr.opened", occurredAt: at(42), number: 101 } as LedgerEvent,
      {
        kind: "pr.linked",
        occurredAt: at(41),
        number: 101,
        agent: "idea-8-writer",
      } as LedgerEvent,
      split("idea-8-writer", 41, { lowInput: MILLION }),
      { kind: "pr.merged", occurredAt: at(50), number: 101 } as LedgerEvent,
    ];

    const figures = costWaitingIn(events, WINDOW, OPTIONS);

    expect(figures.mergedChanges.changes).toEqual([
      {
        number: 100,
        joined: true,
        dollars: 8,
        tokens: 4 * MILLION,
        launchToMergeSeconds: 1800,
        waitSeconds: 1500,
      },
      {
        number: 101,
        joined: true,
        dollars: 1,
        tokens: MILLION,
        launchToMergeSeconds: 600,
        waitSeconds: 480,
      },
    ]);
    expect(figures.mergedChanges.dollars).toMatchObject({
      total: 9,
      median: 4.5,
      p90: 8,
    });
  });
});
