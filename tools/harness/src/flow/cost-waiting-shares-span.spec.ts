import { describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { ideaSpanSeconds } from "./cost-waiting-shares-span.js";

// The event time is mocked: an event's occurredAt is its time in milliseconds.
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Number(event.occurredAt),
}));

const event = (idea: string | undefined, at: number): LedgerEvent =>
  ({ kind: "session.launch", occurredAt: String(at), idea }) as LedgerEvent;

describe("an idea's span: its first event to its last", () => {
  const events = [
    event("7", 5_000),
    event("8", 1_000),
    event("7", 65_000),
    event("7", 125_000),
    event("8", 900_000),
    event(undefined, 9_000_000),
  ];

  it("is the seconds from the idea's first event to its last, whatever other ideas did between", () => {
    expect(ideaSpanSeconds(events, "7")).toBe(120);
  });

  it("is zero seconds for an idea with one event, a span and not a missing one", () => {
    expect(ideaSpanSeconds([event("9", 4_000)], "9")).toBe(0);
  });

  it("is null, never zero, for an idea no event is stamped with", () => {
    expect(ideaSpanSeconds(events, "42")).toBeNull();
  });
});
