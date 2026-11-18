import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import type { ModelPrice } from "./writer-prices.js";
import { costWaitingIn } from "./cost-waiting.js";

// The writing join composed with the idea rows and the buckets, over built ledger events (#1093).

const HAIKU = "claude-haiku-5-5";
const MILLION = 1_000_000;

// A fixture price table: input at one dollar per million tokens, output at five, nothing else.
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
const OPTIONS = { prices: PRICES, minimum: 1 };

/** A time in the window, by minutes after 10:00 UTC on the window's first day. */
const at = (minute: number) =>
  new Date(Date.parse("2026-11-18T10:00:00Z") + minute * 60_000).toISOString();

/** A cumulative token reading of one session's model, as the stop hook writes it. */
const split = (agent: string, minute: number, counts: Partial<LedgerEvent>) =>
  ({
    kind: "token.split",
    occurredAt: at(minute),
    agent,
    model: HAIKU,
    ...counts,
  }) as LedgerEvent;

const writer = (agent: string) =>
  ({
    kind: "session.launch",
    occurredAt: at(-30),
    agent,
    role: "writer",
  }) as LedgerEvent;
const linked = (agent: string, number: number, idea: string) =>
  ({
    kind: "pr.linked",
    source: "herdr",
    occurredAt: at(2),
    agent,
    session: agent,
    number,
    idea,
  }) as LedgerEvent;
const opened = (number: number) =>
  ({
    kind: "pr.opened",
    source: "github",
    occurredAt: at(3),
    number,
  }) as LedgerEvent;

const EVENTS: LedgerEvent[] = [
  writer("w-idea"),
  writer("w-none"),
  writer("w-lone"),
  // $7 over 3M tokens, linked to a pull request with idea #7.
  split("w-idea", 1, { lowInput: 2 * MILLION, lowOutput: MILLION }),
  linked("w-idea", 9, "#7"),
  // $1 over 1M tokens, linked to a pull request that serves no idea.
  split("w-none", 1, { lowInput: MILLION }),
  linked("w-none", 10, "none"),
  // $6 over 2M tokens, a writer with no pr.linked event.
  split("w-lone", 1, { lowInput: MILLION, lowOutput: MILLION }),
  opened(9),
  opened(10),
  // A pull request opened with no link event: unjoinable.
  opened(11),
];

describe("cost and waiting: a linked writer's cost lands in its pull request's idea (#1093)", () => {
  it("adds the linked writer's tokens and dollars to its idea, and to no other idea", () => {
    const { ideas } = costWaitingIn(EVENTS, WINDOW, OPTIONS);

    expect(ideas).toEqual([
      {
        idea: "#7",
        dollars: 7,
        tokens: 3 * MILLION,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
  });

  it("reports the no-idea and no-pull-request buckets beside the ideas, each with its own exact figures, and no idea named none", () => {
    const { writing, ideas } = costWaitingIn(EVENTS, WINDOW, OPTIONS);

    expect(writing.attributed).toEqual({
      sessions: 1,
      tokens: 3 * MILLION,
      dollars: 7,
    });
    expect(writing.noIdea).toEqual({
      sessions: 1,
      tokens: MILLION,
      dollars: 1,
    });
    expect(writing.noPullRequest).toEqual({
      sessions: 1,
      tokens: 2 * MILLION,
      dollars: 6,
    });
    expect(ideas.map((row) => row.idea)).not.toContain("none");
  });
});

describe("cost and waiting: the share of writer tokens attributed to an idea (#1093)", () => {
  it("reports the share and the pull requests opened with no link", () => {
    const { writing } = costWaitingIn(EVENTS, WINDOW, OPTIONS);

    expect(writing.share).toEqual({
      status: "measured",
      share: 0.5,
      sessions: 3,
    });
    expect(writing.unjoinable).toBe(1);
  });

  it("reads the share as insufficient below the minimum writer sessions, never zero", () => {
    const { writing } = costWaitingIn(EVENTS, WINDOW, {
      ...OPTIONS,
      minimum: 4,
    });

    expect(writing.share).toEqual({
      status: "insufficient",
      sessions: 3,
      needed: 4,
    });
  });

  it("names a writer's unpriced model as insufficient prices in its bucket, never zero", () => {
    const unpriced = [
      writer("w-lone"),
      { ...split("w-lone", 1, { lowInput: MILLION }), model: "zeta" },
    ];

    const { writing } = costWaitingIn(unpriced, WINDOW, OPTIONS);

    expect(writing.noPullRequest).toEqual({
      sessions: 1,
      tokens: MILLION,
      dollars: null,
      unpricedModels: ["zeta"],
    });
  });
});
