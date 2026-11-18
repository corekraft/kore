import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { countsBefore, tokenSession } from "./merged-tokens.js";
import { inWindow } from "./scope.js";
import { tokenStageResolver } from "./stage-of.js";
import { pricedLaunches, type PricedLaunch } from "./writer-join.js";
import { sendsIn, weightedTokensIn } from "./writer-usage.js";
import { priceWeight } from "./writer-prices.js";

vi.mock("./github-waits.js", () => ({ time: vi.fn() }));
vi.mock("./merged-tokens.js", () => ({
  countsBefore: vi.fn(),
  tokenSession: vi.fn(),
}));
vi.mock("./scope.js", () => ({ inWindow: vi.fn() }));
vi.mock("./stage-of.js", () => ({ tokenStageResolver: vi.fn() }));
vi.mock("./writer-join.js", () => ({ pricedLaunches: vi.fn() }));
vi.mock("./writer-prices.js", () => ({ priceWeight: vi.fn() }));

const WINDOW: [number, number] = [1000, 2000];
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

const WEIGHTS: Record<string, number> = {
  [HAIKU]: 1,
  [SONNET]: 20,
  [OPUS]: 40,
};

/** A ledger event with only the fields the mocked readers look at. */
const at = (ms: number, extra: Partial<LedgerEvent>): LedgerEvent =>
  ({
    kind: "token.usage",
    occurredAt: new Date(ms).toISOString(),
    tokens: 1,
    ...extra,
  }) as LedgerEvent;

/** A priced writer launch, as the mocked join hands it over. */
const writer = (
  agent: string,
  pane: string,
  tier: string,
  launchedAt: number,
): PricedLaunch => ({
  agent,
  pane,
  tier,
  idea: undefined,
  effort: undefined,
  tierReason: undefined,
  at: launchedAt,
});

/** The cumulative token count per session, at the span's start or end. */
function counts(end: Map<string, number>, start: Map<string, number>) {
  vi.mocked(countsBefore).mockImplementation((_events, ms) =>
    ms === WINDOW[1] ? end : start,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(time).mockImplementation((e) => Date.parse(e.occurredAt));
  vi.mocked(tokenSession).mockImplementation(
    (e) => (e as { session: string }).session,
  );
  vi.mocked(priceWeight).mockImplementation((tier) => WEIGHTS[tier]);
  vi.mocked(inWindow).mockImplementation(
    ([start, end], ms) => ms >= start && ms < end,
  );
  vi.mocked(tokenStageResolver).mockReturnValue(() => "write");
});

describe("writer usage: a writer's tokens in the span, by tier", () => {
  it("weights each writer's tokens spent inside the span by its tier's price, and lists the writer as spending them", () => {
    vi.mocked(pricedLaunches).mockReturnValue([
      writer("h-writer", "w1:p1", HAIKU, 100),
      writer("s-writer", "w1:p2", SONNET, 150),
    ]);
    counts(
      new Map([
        ["h-s", 40],
        ["s-s", 10],
      ]),
      new Map([
        ["h-s", 10],
        ["s-s", 0],
      ]),
    );
    const events = [
      at(1100, { session: "h-s", agent: "h-writer" }),
      at(1200, { session: "s-s", agent: "s-writer" }),
    ];

    const r = weightedTokensIn(events, WINDOW);

    expect(r.byTier).toEqual(
      new Map([
        [HAIKU, 30],
        [SONNET, 200],
      ]),
    );
    expect([...r.spent].sort()).toEqual(["h-writer", "s-writer"]);
  });

  it("leaves a writer that spent no tokens inside the span out of the spent set, with zero in its tier", () => {
    vi.mocked(pricedLaunches).mockReturnValue([
      writer("h-writer", "w1:p1", HAIKU, 100),
    ]);
    counts(new Map([["h-s", 10]]), new Map([["h-s", 10]]));

    const r = weightedTokensIn(
      [at(950, { session: "h-s", agent: "h-writer" })],
      WINDOW,
    );

    expect(r.spent).toEqual(new Set());
    expect(r.byTier).toEqual(new Map([[HAIKU, 0]]));
  });

  it("leaves a session whose tier is not in the launches out of every tier, not counted as a zero", () => {
    vi.mocked(pricedLaunches).mockReturnValue([]);
    counts(new Map([["x-s", 500]]), new Map([["x-s", 0]]));

    const r = weightedTokensIn(
      [at(1100, { session: "x-s", agent: "x-writer" })],
      WINDOW,
    );

    expect(r.byTier).toEqual(new Map());
    expect(r.spent).toEqual(new Set());
  });

  it("weights the orchestrating session's tokens at the main-session model", () => {
    vi.mocked(pricedLaunches).mockReturnValue([]);
    vi.mocked(tokenStageResolver).mockReturnValue(() => "orchestrate");
    counts(new Map([["main-s", 25]]), new Map([["main-s", 0]]));

    const r = weightedTokensIn([at(1300, { session: "main-s" })], WINDOW);

    expect(r.orchestrate).toBe(1000);
    expect(r.byTier).toEqual(new Map());
  });
});

describe("writer usage: follow-ups sent to each tier's writer panes", () => {
  it("counts a send to a writer pane inside the span under that pane's tier, and nothing else", () => {
    vi.mocked(pricedLaunches).mockReturnValue([
      writer("h-writer", "w1:p1", HAIKU, 100),
      writer("s-writer", "w1:p2", SONNET, 150),
    ]);
    const send = (ms: number, pane: string) =>
      ({
        kind: "session.send",
        occurredAt: new Date(ms).toISOString(),
        pane,
      }) as LedgerEvent;
    const events = [
      send(1250, "w1:p1"),
      send(1260, "w1:p1"),
      send(1270, "w1:p2"),
      send(1280, "w1:p9"),
      send(500, "w1:p1"),
    ];

    expect(sendsIn(events, WINDOW)).toEqual(
      new Map([
        [HAIKU, 2],
        [SONNET, 1],
      ]),
    );
  });
});
