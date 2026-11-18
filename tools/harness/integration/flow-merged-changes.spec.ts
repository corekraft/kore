import { describe, expect, it } from "vitest";
import { buildReport, flowMetricNames } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

// Tokens by stage (#831): each session's cumulative reading, by the role its agent names.
const STAGE_EVENTS = [
  at(0, "token.usage", { session: "w", agent: "flow-writer", tokens: 100 }),
  at(1200, "token.usage", { session: "w", agent: "flow-writer", tokens: 400 }),
  at(1300, "token.usage", { session: "r", agent: "flow-reviewer", tokens: 50 }),
  at(1400, "token.usage", { session: "m", tokens: 25 }),
  at(1500, "token.usage", { session: "n", agent: "flow-notes", tokens: 10 }),
  at(1600, "pr.merged", { number: 11 }),
  at(1700, "pr.merged", { number: 12 }),
];

// Window: 1000 s to 2000 s after T0. Lead time runs from each PR's opening.
const WINDOW = {
  since: new Date(T0 + 1000 * 1000),
  until: new Date(T0 + 2000 * 1000),
};
const EVENTS = [
  at(0, "pr.opened", { number: 11 }),
  at(100, "pr.opened", { number: 12 }),
  at(1200, "pr.merged", { number: 11 }),
  at(1700, "pr.merged", { number: 12 }),
  at(1500, "send-back", {
    number: 11,
    label: "too slow @abcdef1",
    category: "scope",
  }),
  at(1800, "send-back", {
    number: 12,
    label: "wrong file @1234567",
    category: "conflict",
  }),
  at(2500, "pr.merged", { number: 13 }),
];

const NO_TRAILING = {
  status: "insufficient merged changes",
  merged: 0,
  needed: 2,
};

describe("flow report send-backs per merged change (#830)", () => {
  it("divides the send-backs in the window by its merged changes, with the trailing average", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      cost: { minMergedChanges: 2 },
    });

    expect(r.sendBacksPerMergedChange).toEqual({
      trailingDays: 7,
      minMergedChanges: 2,
      current: { status: "ok", sendBacks: 2, merged: 2, perMerged: 1 },
      trailingAverage: NO_TRAILING,
    });
  });

  it("reads no send-back figure below the placeholder minimum, so a thin window is never read", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.sendBacksPerMergedChange.current).toEqual({
      status: "insufficient merged changes",
      merged: 2,
      needed: 5,
    });
  });
});

describe("flow report lead time per merged change (#830)", () => {
  it("takes each merged change's lead time from its pull request's opening, and reports the median", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      cost: { minMergedChanges: 2 },
    });

    expect(r.leadTimePerMergedChange).toEqual({
      trailingDays: 7,
      minMergedChanges: 2,
      current: { status: "ok", merged: 2, measured: 2, medianSeconds: 1400 },
      trailingAverage: { ...NO_TRAILING, measured: 0 },
    });
  });

  it("reads no lead time below the placeholder minimum, so a thin window is never read", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.leadTimePerMergedChange.current).toEqual({
      status: "insufficient merged changes",
      merged: 2,
      measured: 2,
      needed: 5,
    });
  });

  it("measures a merge with no opening event from the opened time the merge carries", () => {
    const r = buildReport(
      [
        at(1900, "pr.merged", {
          number: 14,
          openedAt: new Date(T0 + 1500 * 1000).toISOString(),
        }),
      ],
      {
        asOf: ASOF,
        minCompletedIdeas: 1,
        ...WINDOW,
        cost: { minMergedChanges: 1 },
      },
    );

    expect(r.leadTimePerMergedChange.current).toEqual({
      status: "ok",
      merged: 1,
      measured: 1,
      medianSeconds: 400,
    });
  });
});

describe("flow report tokens by stage (#831)", () => {
  it("splits the window's tokens by the stage each session spent in, with no-role sessions in orchestrate", () => {
    const r = buildReport(STAGE_EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      cost: { minMergedChanges: 2 },
    });

    expect(r.tokensByStage).toEqual({
      refine: 0,
      "await approval": 0,
      orchestrate: 35,
      write: 300,
      review: 50,
      judge: 0,
      merge: 0,
      verify: 0,
      outcome: 0,
    });
  });

  it("divides each stage's tokens by the merged changes, with a trailing average beside it", () => {
    const r = buildReport(STAGE_EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      cost: { minMergedChanges: 2 },
    });

    expect(r.tokensByStagePerMergedChange).toMatchObject({
      trailingDays: 7,
      minMergedChanges: 2,
      current: {
        status: "ok",
        merged: 2,
        perMerged: { orchestrate: 17.5, write: 150, review: 25 },
      },
      trailingAverage: {
        status: "insufficient merged changes",
        merged: 0,
        needed: 2,
      },
    });
  });

  it("reads no stage figure below the placeholder minimum, so a thin window is never read", () => {
    const r = buildReport(STAGE_EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.tokensByStagePerMergedChange.current).toEqual({
      status: "insufficient merged changes",
      merged: 2,
      needed: 5,
    });
  });

  it("registers the stage figures' names in the metric list the qualifier and retro proposals read", () => {
    expect(flowMetricNames()).toEqual(
      expect.arrayContaining([
        "tokensByStage.write",
        "tokensByStage.orchestrate",
        "tokensByStagePerMergedChange.current",
        "tokensByStagePerMergedChange.trailingAverage",
      ]),
    );
  });
});

// Writer cost (#868): each writer's tokens, weighted by its launch tier's price.
const WRITER_EVENTS = [
  at(1100, "session.launch", {
    agent: "flow-writer",
    pane: "w1:p1",
    role: "writer",
    tier: "claude-haiku-5-5",
  }),
  at(1200, "token.usage", { session: "w1", agent: "flow-writer", tokens: 100 }),
  at(1300, "session.launch", {
    agent: "flow-sonnet-writer",
    pane: "w1:p2",
    role: "writer",
    tier: "claude-sonnet-5-5",
  }),
  at(1310, "token.usage", {
    session: "w2",
    agent: "flow-sonnet-writer",
    tokens: 10,
  }),
  at(1400, "pr.merged", { number: 11 }),
  at(1500, "pr.merged", { number: 12 }),
  at(1600, "pr.merged", { number: 13 }),
  at(1700, "pr.merged", { number: 14 }),
  at(1800, "pr.merged", { number: 15 }),
];

describe("flow report writer cost per merged change by tier (#868)", () => {
  it("weights each tier's writer tokens by its price, over the window's merged changes", () => {
    const r = buildReport(WRITER_EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.writerCost.current).toMatchObject({
      status: "ok",
      merged: 5,
      tiers: {
        "claude-haiku-5-5": {
          sessions: 1,
          weightedTokens: 100,
        },
        "claude-sonnet-5-5": {
          sessions: 1,
          weightedTokens: 200,
        },
      },
    });
  });

  it("registers the writer cost figures' names in the metric list", () => {
    expect(flowMetricNames()).toEqual(
      expect.arrayContaining([
        "writerCost.current",
        "writerCost.trailingAverage",
      ]),
    );
  });
});
