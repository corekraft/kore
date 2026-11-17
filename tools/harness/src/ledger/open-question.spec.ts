import { describe, expect, it } from "vitest";
import { hasOpenQuestion } from "./open-question.js";
import type { LedgerEvent } from "./schema.js";

const T0 = Date.parse("2026-11-17T10:00:00.000Z");
const at = (minutes: number) => T0 + minutes * 60_000;
const PANE = "w3:p1";
const NOW = at(60);

/** A decision.routed to the owner: the question a pane posted on an issue, `minutes` from T0. */
function asked(minutes: number, extra: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    schema: 1,
    id: `routed-${minutes}`,
    source: "claude",
    kind: "decision.routed",
    occurredAt: new Date(at(minutes)).toISOString(),
    recordedAt: new Date(at(minutes)).toISOString(),
    idea: "0009",
    route: "owner",
    signal: "reserved-category",
    label: "naming",
    pane: PANE,
    number: 854,
    ...extra,
  };
}

/** The same event with one optional field left out, as a route recorded without it reads. */
function without(event: LedgerEvent, field: "pane" | "number"): LedgerEvent {
  const copy = { ...event };
  delete copy[field];
  return copy;
}

/** An untagged owner reply on an issue, `minutes` from T0. */
function reply(minutes: number, number = 854): LedgerEvent {
  return {
    schema: 1,
    id: `replied-${minutes}-${number}`,
    source: "github",
    kind: "owner.replied",
    occurredAt: new Date(at(minutes)).toISOString(),
    recordedAt: new Date(at(minutes)).toISOString(),
    number,
  };
}

describe("hasOpenQuestion: a pane waiting on a reserved question it posted", () => {
  it("is open for a question the pane posted with no owner reply on its issue yet", () => {
    expect(hasOpenQuestion([asked(1)], PANE, NOW)).toBe(true);
  });

  it("is closed once an untagged owner reply on the issue came after the question", () => {
    expect(hasOpenQuestion([asked(1), reply(5)], PANE, NOW)).toBe(false);
  });

  it("stays open when the owner's reply came before the question was posted", () => {
    expect(hasOpenQuestion([reply(0), asked(1)], PANE, NOW)).toBe(true);
  });

  it("stays open when the owner replied on a different issue", () => {
    expect(hasOpenQuestion([asked(1), reply(5, 900)], PANE, NOW)).toBe(true);
  });

  it("is not open for a question another pane posted", () => {
    expect(hasOpenQuestion([asked(1, { pane: "w3:p2" })], PANE, NOW)).toBe(
      false,
    );
  });

  it("is not open for a route recorded without a pane, since nothing was posted from a pane", () => {
    expect(hasOpenQuestion([without(asked(1), "pane")], PANE, NOW)).toBe(false);
  });

  it("is not open for a question with no issue number, which no reply can close", () => {
    expect(hasOpenQuestion([without(asked(1), "number")], PANE, NOW)).toBe(
      false,
    );
  });

  it("is not open for a question the advisor was given, which is never posted to the owner", () => {
    expect(hasOpenQuestion([asked(1, { route: "advisor" })], PANE, NOW)).toBe(
      false,
    );
  });

  it("is not open for a question asked after the measuring point", () => {
    expect(hasOpenQuestion([asked(61)], PANE, NOW)).toBe(false);
  });

  it("is open again for a second question after the first was answered", () => {
    expect(
      hasOpenQuestion(
        [asked(1), reply(5), asked(10, { id: "routed-10" })],
        PANE,
        NOW,
      ),
    ).toBe(true);
  });

  it("ignores every other kind, token usage included", () => {
    const tokens: LedgerEvent = {
      schema: 1,
      id: "token-1",
      source: "claude",
      kind: "token.usage",
      occurredAt: new Date(at(1)).toISOString(),
      recordedAt: new Date(at(1)).toISOString(),
      pane: PANE,
      tokens: 1000,
    };
    expect(hasOpenQuestion([tokens], PANE, NOW)).toBe(false);
  });
});
