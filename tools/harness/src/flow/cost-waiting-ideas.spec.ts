import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { ideaRowsIn } from "./cost-waiting-ideas.js";
import { cumulativeOf } from "./cost-waiting-support.js";

vi.mock("./cost-waiting-support.js", () => ({
  cumulativeOf: vi.fn(),
  round: (value: number) => Math.round(value * 10_000) / 10_000,
}));
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Date.parse(event.occurredAt),
  firstTime: (events: LedgerEvent[], match: (e: LedgerEvent) => boolean) =>
    events
      .filter(match)
      .map((e) => Date.parse(e.occurredAt))
      .sort((a, b) => a - b)[0],
}));

const MINUTE = 60_000;
const BASE = Date.parse("2026-11-18T10:00:00Z");
const at = (minute: number) => new Date(BASE + minute * MINUTE).toISOString();
const PRICES = {};
const OPTIONS = { prices: PRICES, minimum: 1 };

const event = (idea: string, kind: string, minute: number): LedgerEvent =>
  ({ kind, idea, occurredAt: at(minute) }) as LedgerEvent;

describe("idea rows: each idea's cost to the window's end and its outcome", () => {
  beforeEach(() => {
    vi.mocked(cumulativeOf).mockImplementation((own) => ({
      tokens: own.length * 1000,
      dollars: 2.5,
    }));
  });

  it("lists each idea in numeric order with its dollars, tokens, lead time and closed outcome", () => {
    const events = [
      event("10", "session.launch", 2),
      event("7", "session.launch", 0),
      event("8", "token.split", 1),
      event("7", "issue.closed", 60),
    ];

    expect(ideaRowsIn(events, [BASE, BASE + 90 * MINUTE], OPTIONS)).toEqual([
      {
        idea: "7",
        dollars: 2.5,
        tokens: 2000,
        leadTimeSeconds: 3600,
        outcome: "closed",
      },
      {
        idea: "8",
        dollars: 2.5,
        tokens: 1000,
        leadTimeSeconds: null,
        outcome: null,
      },
      {
        idea: "10",
        dollars: 2.5,
        tokens: 1000,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
  });

  it("leaves an outcome outside the window out: no outcome and no lead time", () => {
    const events = [
      event("7", "session.launch", 0),
      event("7", "issue.closed", 60),
    ];

    expect(ideaRowsIn(events, [BASE, BASE + 30 * MINUTE], OPTIONS)).toEqual([
      {
        idea: "7",
        dollars: 2.5,
        tokens: 2000,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
  });

  it("reads each idea's cumulative cost to the window's end", () => {
    const events = [event("7", "session.launch", 0)];

    ideaRowsIn(events, [BASE, BASE + 30 * MINUTE], OPTIONS);

    expect(cumulativeOf).toHaveBeenCalledWith(
      events,
      BASE + 30 * MINUTE,
      PRICES,
    );
  });
});
