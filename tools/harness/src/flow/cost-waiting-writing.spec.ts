import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { writingIn } from "./cost-waiting-writing.js";
import { cumulativeOf } from "./cost-waiting-support.js";
import { writerLinks, type WriterLink } from "./writer-link-ideas.js";

vi.mock("./cost-waiting-support.js", () => ({
  cumulativeOf: vi.fn(),
  round: (value: number, places = 4) =>
    Math.round(value * 10 ** places) / 10 ** places,
}));
vi.mock("./writer-link-ideas.js", () => ({
  NO_IDEA: "none",
  writerLinks: vi.fn(),
}));
vi.mock("./writing-spend.js", () => ({
  NO_SPEND: { tokens: 0, dollars: 0, unpriced: [] },
  addSpend: (
    a: { tokens: number; dollars: number; unpriced: string[] },
    b: { tokens: number; dollars: number; unpriced: string[] },
  ) => ({
    tokens: a.tokens + b.tokens,
    dollars: a.dollars + b.dollars,
    unpriced: [...new Set([...a.unpriced, ...b.unpriced])].sort(),
  }),
}));
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Date.parse(event.occurredAt),
}));
vi.mock("./scope.js", () => ({
  inWindow: (window: [number, number], at: number) =>
    at >= window[0] && at < window[1],
}));

const MINUTE = 60_000;
const BASE = Date.parse("2026-11-18T10:00:00Z");
const WINDOW: [number, number] = [BASE, BASE + 60 * MINUTE];
const at = (minute: number) => new Date(BASE + minute * MINUTE).toISOString();
const OPTIONS = { prices: {}, minimum: 1 };

const event = (
  minute: number,
  kind: Kind,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent => ({ kind, occurredAt: at(minute), ...fields }) as LedgerEvent;

const writer = (agent: string) =>
  event(-10, "session.launch", { agent, role: "writer" });
const split = (
  minute: number,
  agent: string,
  fields: Partial<LedgerEvent> = {},
) => event(minute, "token.split", { agent, model: "alpha", ...fields });

/** A session's reading as the support reads it: 100 tokens and half a dollar per reading, zeta unpriced. */
function read(events: LedgerEvent[]) {
  return {
    tokens: events.length * 100,
    dollars: events.length * 0.5,
    unpriced: events.some((e) => e.model === "zeta") ? ["zeta"] : [],
  };
}

const links = (entries: Record<string, WriterLink>) =>
  vi.mocked(writerLinks).mockReturnValue(new Map(Object.entries(entries)));

beforeEach(() => {
  vi.mocked(cumulativeOf).mockImplementation((events) => read(events));
  links({});
});

describe("writing: a linked pull request's writer is charged to the idea on its link", () => {
  it("adds a linked writer's cumulative tokens and dollars to the idea its pull request carries", () => {
    links({ w1: { number: 9, idea: "#7" } });
    const events = [writer("w1"), split(1, "w1"), split(2, "w1")];

    const { byIdea, figure } = writingIn(events, WINDOW, OPTIONS);

    expect(byIdea).toEqual(
      new Map([["#7", { tokens: 200, dollars: 1, unpriced: [] }]]),
    );
    expect(figure.attributed).toEqual({ sessions: 1, tokens: 200, dollars: 1 });
    expect(figure.noIdea).toEqual({ sessions: 0, tokens: 0, dollars: 0 });
  });

  it("reads each writer's spend to the window's end, from its own readings only", () => {
    links({ w1: { number: 9, idea: "#7" } });
    const own = split(1, "w1");
    const other = split(1, "w2");

    writingIn([writer("w1"), writer("w2"), own, other], WINDOW, OPTIONS);

    expect(cumulativeOf).toHaveBeenCalledWith([own], WINDOW[1], {});
  });

  it("puts a writer whose pull request carries no idea in the no-idea bucket and in no idea", () => {
    links({ w2: { number: 10, idea: undefined } });

    const { byIdea, figure } = writingIn(
      [writer("w2"), split(1, "w2")],
      WINDOW,
      OPTIONS,
    );

    expect(byIdea.size).toBe(0);
    expect(figure.noIdea).toEqual({ sessions: 1, tokens: 100, dollars: 0.5 });
    expect(figure.attributed.sessions).toBe(0);
  });

  it("puts a writer with no link in the no-pull-request bucket and in no idea", () => {
    const { byIdea, figure } = writingIn(
      [writer("w3"), split(1, "w3"), split(2, "w3"), split(3, "w3")],
      WINDOW,
      OPTIONS,
    );

    expect(byIdea.size).toBe(0);
    expect(figure.noPullRequest).toEqual({
      sessions: 1,
      tokens: 300,
      dollars: 1.5,
    });
    expect(figure.noIdea.sessions).toBe(0);
  });

  it("charges a session's whole spend to one idea, the idea of its earliest link", () => {
    links({ w1: { number: 9, idea: "#7" } });

    const { byIdea } = writingIn(
      [writer("w1"), split(1, "w1")],
      WINDOW,
      OPTIONS,
    );

    expect([...byIdea.keys()]).toEqual(["#7"]);
  });
});

describe("writing: sessions already stamped with an idea are not double counted", () => {
  it("adds nothing to an idea for a writer whose readings carry an idea, though its link names one", () => {
    links({ w4: { number: 11, idea: "#7" } });

    const { byIdea, figure } = writingIn(
      [writer("w4"), split(1, "w4", { idea: "#5" })],
      WINDOW,
      OPTIONS,
    );

    expect(byIdea.size).toBe(0);
    expect(figure.attributed).toEqual({
      sessions: 1,
      tokens: 100,
      dollars: 0.5,
    });
  });

  it("does not read a stamp of none as an idea", () => {
    const { figure } = writingIn(
      [writer("w4"), split(1, "w4", { idea: "none" })],
      WINDOW,
      OPTIONS,
    );

    expect(figure.attributed.sessions).toBe(0);
    expect(figure.noPullRequest.sessions).toBe(1);
  });
});

describe("writing: which sessions are read", () => {
  it("leaves out a session with no writer launch", () => {
    const { figure } = writingIn(
      [
        event(-5, "session.launch", { agent: "r1", role: "reviewer" }),
        split(1, "r1"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(figure.noPullRequest.sessions).toBe(0);
    expect(figure.share).toEqual({
      status: "insufficient",
      sessions: 0,
      needed: 1,
    });
  });

  it("leaves out a writer with no reading inside the window", () => {
    const { figure } = writingIn(
      [writer("w5"), split(-5, "w5"), split(61, "w5")],
      WINDOW,
      OPTIONS,
    );

    expect(figure.noPullRequest.sessions).toBe(0);
  });
});

describe("writing: the share of writer tokens attributed to an idea", () => {
  const events = [
    writer("w1"),
    split(1, "w1"),
    split(2, "w1"),
    writer("w2"),
    split(1, "w2"),
    writer("w3"),
    split(1, "w3"),
    split(2, "w3"),
    split(3, "w3"),
    writer("w4"),
    split(1, "w4", { idea: "#5" }),
  ];

  beforeEach(() => {
    links({
      w1: { number: 9, idea: "#7" },
      w2: { number: 10, idea: undefined },
      w4: { number: 11, idea: "#7" },
    });
  });

  it("is the attributed tokens over every writer's tokens in the window", () => {
    const { figure } = writingIn(events, WINDOW, OPTIONS);

    expect(figure.share).toEqual({
      status: "measured",
      share: 0.4286,
      sessions: 4,
    });
  });

  it("reads insufficient, with the session count and the minimum, below the minimum writer sessions, never zero", () => {
    const { figure } = writingIn(events, WINDOW, { ...OPTIONS, minimum: 5 });

    expect(figure.share).toEqual({
      status: "insufficient",
      sessions: 4,
      needed: 5,
    });
  });
});

describe("writing: an unpriced model", () => {
  it("reads a bucket with an unpriced model as null dollars naming it, keeping its tokens", () => {
    links({ w2: { number: 10, idea: undefined } });

    const { figure } = writingIn(
      [writer("w2"), split(1, "w2", { model: "zeta" })],
      WINDOW,
      OPTIONS,
    );

    expect(figure.noIdea).toEqual({
      sessions: 1,
      tokens: 100,
      dollars: null,
      unpricedModels: ["zeta"],
    });
  });

  it("carries the unpriced model to the idea the writer is charged to", () => {
    links({ w1: { number: 9, idea: "#7" } });

    const { byIdea } = writingIn(
      [writer("w1"), split(1, "w1", { model: "zeta" })],
      WINDOW,
      OPTIONS,
    );

    expect(byIdea.get("#7")).toEqual({
      tokens: 100,
      dollars: 0.5,
      unpriced: ["zeta"],
    });
  });
});

describe("writing: pull requests opened with no link are unjoinable", () => {
  it("counts each pull request opened in the window with no link event once, and not one with a link", () => {
    const events = [
      event(1, "pr.opened", { source: "github", number: 20 }),
      event(2, "pr.opened", { source: "github", number: 20 }),
      event(3, "pr.opened", { source: "github", number: 21 }),
      event(4, "pr.opened", { source: "github", number: 22 }),
      event(5, "pr.linked", { number: 22, agent: "w1" }),
      event(-5, "pr.opened", { source: "github", number: 23 }),
    ];

    expect(writingIn(events, WINDOW, OPTIONS).figure.unjoinable).toBe(2);
  });

  it("is a count of zero only when every pull request opened in the window is linked", () => {
    expect(writingIn([], WINDOW, OPTIONS).figure.unjoinable).toBe(0);
  });
});
