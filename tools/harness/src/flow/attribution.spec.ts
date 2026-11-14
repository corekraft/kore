import type { Kind, LedgerEvent } from "../ledger/index.js";
import { describe, expect, it } from "vitest";
import { attribute } from "./attribution.js";

const T0 = Date.parse("2026-01-02T00:00:00.000Z");

let seq = 0;

/** A ledger event `seconds` after T0; the source is claude unless the fields name one. */
function at(
  seconds: number,
  kind: Kind,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent {
  seq += 1;
  const occurredAt = new Date(T0 + seconds * 1000).toISOString();
  return {
    schema: 1,
    id: `e${seq}`,
    source: "claude",
    kind,
    occurredAt,
    recordedAt: occurredAt,
    ...fields,
  };
}

describe("attribute", () => {
  it("keys an issue event by its own issue number", () => {
    const opened = at(0, "issue.opened", { number: 7 });
    expect(attribute([opened])).toEqual(new Map([[opened.id, "#7"]]));
  });

  it("keeps the idea an event names over its own issue number", () => {
    const closed = at(0, "issue.closed", { number: 7, idea: "#9" });
    expect(attribute([closed]).get(closed.id)).toBe("#9");
  });

  it("gives an event with no idea and no issue number no idea", () => {
    const usage = at(0, "token.usage", { session: "s1", tokens: 10 });
    expect(attribute([usage]).get(usage.id)).toBeUndefined();
  });

  it("gives an event the idea its pane named, from an earlier event on that pane", () => {
    const named = at(0, "pane.spawned", { pane: "p1", idea: "#3" });
    const later = at(5, "tool.end", { pane: "p1" });
    expect(attribute([named, later]).get(later.id)).toBe("#3");
  });

  it("gives an event the idea its session named when its pane named none", () => {
    const named = at(0, "session.launch", { session: "s1", idea: "#4" });
    const later = at(5, "token.usage", { session: "s1", tokens: 1 });
    expect(attribute([named, later]).get(later.id)).toBe("#4");
  });

  it("prefers the pane's idea to the session's when both name one", () => {
    const byPane = at(0, "pane.spawned", { pane: "p1", idea: "#3" });
    const bySession = at(1, "session.launch", { session: "s1", idea: "#4" });
    const later = at(5, "tool.end", { pane: "p1", session: "s1" });
    expect(attribute([byPane, bySession, later]).get(later.id)).toBe("#3");
  });

  it("does not let an idea spread to a different pane or session", () => {
    const named = at(0, "pane.spawned", {
      pane: "p1",
      session: "s1",
      idea: "#3",
    });
    const stranger = at(5, "tool.end", { pane: "p2", session: "s2" });
    expect(attribute([named, stranger]).get(stranger.id)).toBeUndefined();
  });

  it("gives every event an entry, keyed by its id", () => {
    const events = [
      at(0, "issue.opened", { number: 1 }),
      at(1, "token.usage", { session: "s1", tokens: 1 }),
    ];
    expect([...attribute(events).keys()]).toEqual(events.map((e) => e.id));
  });
});
