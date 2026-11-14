import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { T0, at } from "./flow-support.js";
import { time } from "./github-waits.js";
import { stampLanded, withPaneAgents } from "./agents.js";

vi.mock("./github-waits.js");

beforeEach(() => {
  vi.mocked(time).mockImplementation((e: LedgerEvent) =>
    Date.parse(e.occurredAt),
  );
});

describe("withPaneAgents", () => {
  it("names an event that names no agent after the agent its pane was last named", () => {
    const named = at(0, "pane.spawned", { pane: "p1", agent: "writer" });
    const unnamed = at(5, "tool.end", { pane: "p1" });
    expect(withPaneAgents([named, unnamed])[1]).toEqual({
      ...unnamed,
      agent: "writer",
    });
  });

  it("uses the latest name at or before the event, not a later one", () => {
    const writer = at(0, "pane.spawned", { pane: "p1", agent: "writer" });
    const judge = at(10, "pane.spawned", { pane: "p1", agent: "judge" });
    const before = at(5, "tool.end", { pane: "p1" });
    const after = at(12, "tool.end", { pane: "p1" });
    const [, , atFive, atTwelve] = withPaneAgents([
      writer,
      judge,
      before,
      after,
    ]);
    expect(atFive).toMatchObject({ agent: "writer" });
    expect(atTwelve).toMatchObject({ agent: "judge" });
  });

  it("leaves an event unnamed when it is before its pane was ever named", () => {
    const early = at(1, "tool.end", { pane: "p1" });
    const named = at(5, "pane.spawned", { pane: "p1", agent: "writer" });
    expect(withPaneAgents([early, named])[0]).toBe(early);
  });

  it("keeps the agent an event already names, even when its pane names another", () => {
    const named = at(0, "pane.spawned", { pane: "p1", agent: "writer" });
    const own = at(5, "tool.end", { pane: "p1", agent: "judge" });
    expect(withPaneAgents([named, own])[1]).toBe(own);
  });

  it("leaves an event with no pane as it is", () => {
    const named = at(0, "pane.spawned", { pane: "p1", agent: "writer" });
    const paneless = at(5, "session.launch", { session: "s1" });
    expect(withPaneAgents([named, paneless])[1]).toBe(paneless);
  });

  it("leaves an event whose pane was never named as it is", () => {
    const stranger = at(5, "tool.end", { pane: "p9" });
    expect(withPaneAgents([stranger])[0]).toBe(stranger);
  });

  it("returns one event per input, in the input's order", () => {
    const events = [
      at(0, "pane.spawned", { pane: "p1", agent: "writer" }),
      at(1, "tool.end", { pane: "p1" }),
      at(2, "tool.end"),
    ];
    const result = withPaneAgents(events);
    expect(result.map((e) => e.id)).toEqual(events.map((e) => e.id));
  });
});

describe("stampLanded", () => {
  it("is the earliest claude event that names its agent", () => {
    const later = at(30, "tool.end", { agent: "writer" });
    const earliest = at(10, "tool.end", { agent: "judge" });
    expect(stampLanded([later, earliest])).toBe(T0 + 10_000);
  });

  it("is undefined when no claude event names an agent", () => {
    const unnamed = at(10, "tool.end");
    const herdr = at(5, "pane.spawned", { pane: "p1", agent: "writer" });
    expect(stampLanded([unnamed, herdr])).toBeUndefined();
  });

  it("ignores a named event that is not from claude", () => {
    const herdr = at(5, "pane.spawned", { pane: "p1", agent: "writer" });
    const claude = at(20, "tool.end", { agent: "judge" });
    expect(stampLanded([herdr, claude])).toBe(T0 + 20_000);
  });
});
