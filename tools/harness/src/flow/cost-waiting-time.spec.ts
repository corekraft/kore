import { describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { secondsBySession } from "./cost-waiting-time.js";

vi.mock("./cost-waiting-support.js", () => ({
  keyOf: (event: LedgerEvent) => event.agent,
}));
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Date.parse(event.occurredAt),
}));

const MINUTE = 60_000;
const BASE = Date.parse("2026-11-18T10:00:00Z");
const at = (minute: number) => new Date(BASE + minute * MINUTE).toISOString();
const WHOLE: [number, number] = [BASE - MINUTE * 100, BASE + MINUTE * 100];

const state = (kind: string, minute: number, agent = "w") =>
  ({ kind, occurredAt: at(minute), agent }) as LedgerEvent;

describe("session seconds: active and waiting time from state events", () => {
  it("charges active until a pane waits, waiting until it is busy again, then active to the stop", () => {
    const events = [
      state("session.start", 0),
      state("pane.waiting", 10),
      state("pane.busy", 20),
      state("session.stop", 30),
    ];

    expect(secondsBySession(events, WHOLE).get("w")).toEqual({
      active: 1200,
      waiting: 600,
    });
  });

  it("does not let a token reading inside a span end it", () => {
    const events = [
      state("session.start", 0),
      { kind: "token.split", occurredAt: at(5), agent: "w" } as LedgerEvent,
      state("session.stop", 10),
    ];

    expect(secondsBySession(events, WHOLE).get("w")).toEqual({
      active: 600,
      waiting: 0,
    });
  });

  it("holds a close until the next spawn, and charges the new life's first state", () => {
    const events = [
      state("session.start", 0),
      state("session.stop", 10),
      // Activity after the close and before the next spawn is not charged.
      state("tool.start", 20),
      state("pane.spawned", 30),
      state("session.stop", 40),
    ];

    expect(secondsBySession(events, WHOLE).get("w")).toEqual({
      active: 1200,
      waiting: 0,
    });
  });

  it("clips the seconds to the window's edges", () => {
    const events = [state("session.start", 0), state("session.stop", 30)];

    expect(
      secondsBySession(events, [BASE + 5 * MINUTE, BASE + 25 * MINUTE]).get(
        "w",
      ),
    ).toEqual({ active: 1200, waiting: 0 });
  });

  it("keys each session by its agent and leaves out events that name no state", () => {
    const events = [
      state("session.start", 0, "a"),
      state("session.stop", 10, "a"),
      state("session.start", 0, "b"),
      state("session.stop", 5, "b"),
      { kind: "token.split", occurredAt: at(1), agent: "c" } as LedgerEvent,
    ];

    const seconds = secondsBySession(events, WHOLE);
    expect(seconds.get("a")).toEqual({ active: 600, waiting: 0 });
    expect(seconds.get("b")).toEqual({ active: 300, waiting: 0 });
    expect(seconds.has("c")).toBe(false);
  });
});
