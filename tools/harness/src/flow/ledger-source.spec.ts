import { describe, expect, it } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { ideaSource, sourcedIdeas, sourceSplit } from "./ledger-source.js";

/** An event at `ms` with the given source, pane and session; its id is its time. */
function event(
  ms: number,
  kind: Kind,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "herdr",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...fields,
  } satisfies LedgerEvent;
}

describe("sourceSplit reads a ledger with no terminal event as one herdr reading", () => {
  const herdrOnly = [
    event(1, "pane.spawned", { source: "herdr", pane: "w1", session: "a" }),
    event(2, "pane.finished", { source: "herdr", pane: "w1", session: "a" }),
    event(3, "session.result", { source: "claude", pane: "w1", session: "a" }),
    event(4, "pr.merged", { source: "github", number: 9 }),
  ];

  it("has no terminal source, so every pane and session event reads as herdr", () => {
    const split = sourceSplit(herdrOnly);
    expect(split.terminal).toBe(false);
    expect(split.of(herdrOnly[1] as LedgerEvent)).toBe("herdr");
    expect(split.of(herdrOnly[2] as LedgerEvent)).toBe("herdr");
  });

  it("gives the herdr view every event unchanged, in order", () => {
    expect(sourceSplit(herdrOnly).view(herdrOnly, "herdr")).toEqual(herdrOnly);
  });
});

describe("sourceSplit reads a pane as terminal when the ledger records a terminal event on it", () => {
  const events = [
    event(1, "pane.spawned", { source: "herdr", pane: "w1", session: "old" }),
    event(2, "pane.finished", { source: "herdr", pane: "w1", session: "old" }),
    event(3, "pane.busy", { source: "terminal", pane: "t7", session: "new" }),
    event(4, "pane.finished", {
      source: "terminal",
      pane: "t7",
      session: "new",
    }),
    event(5, "session.result", {
      source: "claude",
      pane: "t7",
      session: "new",
    }),
  ];

  it("reads the terminal pane's events and its result as terminal, and the herdr pane's as herdr", () => {
    const split = sourceSplit(events);
    expect(split.terminal).toBe(true);
    expect(events.map((e) => split.of(e))).toEqual([
      "herdr",
      "herdr",
      "terminal",
      "terminal",
      "terminal",
    ]);
  });

  it("gives each view only its own source's events, with no blended total", () => {
    const split = sourceSplit(events);
    expect(split.view(events, "herdr").map((e) => e.id)).toEqual(["1", "2"]);
    expect(split.view(events, "terminal").map((e) => e.id)).toEqual([
      "3",
      "4",
      "5",
    ]);
  });
});

describe("sourceSplit keeps an event that names neither a pane nor a session in both views", () => {
  const events = [
    event(1, "pane.finished", { source: "terminal", pane: "t1", session: "s" }),
    event(2, "pr.merged", { source: "github", number: 3 }),
    event(3, "pane.finished", { source: "herdr", pane: "w2", session: "h" }),
  ];

  it("returns the shared event in both views and leaves each source's pane out of the other", () => {
    const split = sourceSplit(events);
    expect(split.of(events[1] as LedgerEvent)).toBeUndefined();
    expect(split.view(events, "herdr").map((e) => e.id)).toEqual(["2", "3"]);
    expect(split.view(events, "terminal").map((e) => e.id)).toEqual(["1", "2"]);
  });
});

describe("sourceSplit reads a session with no pane of its own from the terminal source it ran on", () => {
  it("reads a token reading that names only its session as terminal when the session ran in a terminal", () => {
    const events = [
      event(1, "pane.busy", { source: "terminal", pane: "t4", session: "s4" }),
      event(2, "token.usage", { source: "claude", session: "s4" }),
      event(3, "token.usage", { source: "claude", session: "unknown" }),
    ];
    const split = sourceSplit(events);
    expect(split.of(events[1] as LedgerEvent)).toBe("terminal");
    expect(split.of(events[2] as LedgerEvent)).toBe("herdr");
  });
});

describe("ideaSource gives an idea the source of its first pane or session event", () => {
  it("reads an idea whose first sourced event is terminal as terminal, even after herdr events", () => {
    const own = [
      event(5, "pane.finished", {
        source: "terminal",
        pane: "t1",
        session: "x",
      }),
      event(1, "issue.opened", { source: "github", number: 4 }),
      event(9, "pane.finished", { source: "herdr", pane: "w1", session: "y" }),
    ];
    const split = sourceSplit(own);
    expect(ideaSource(own, split)).toBe("terminal");
  });

  it("reads an idea with no pane or session event as herdr, the source of every line before the terminal", () => {
    const own = [event(1, "issue.opened", { source: "github", number: 4 })];
    expect(ideaSource(own, sourceSplit(own))).toBe("herdr");
  });
});

describe("sourcedIdeas hands each source the ideas that read under it", () => {
  it("keeps each idea under the one source its first pane or session event names, in the map's order", () => {
    const herdrOwn = [
      event(1, "pane.finished", { source: "herdr", pane: "w1", session: "h" }),
    ];
    const terminalOwn = [
      event(2, "pane.finished", {
        source: "terminal",
        pane: "t1",
        session: "t",
      }),
    ];
    const byIdea = new Map([
      ["#1", herdrOwn],
      ["#2", terminalOwn],
    ]);
    const split = sourceSplit([...herdrOwn, ...terminalOwn]);
    expect(sourcedIdeas(byIdea, split, "herdr")).toEqual(
      new Map([["#1", herdrOwn]]),
    );
    expect(sourcedIdeas(byIdea, split, "terminal")).toEqual(
      new Map([["#2", terminalOwn]]),
    );
  });
});
