import { describe, expect, it } from "vitest";
import { firstIdeaStateChange, ideaStates } from "./idea-state.js";
import { SCHEMA_VERSION, type LedgerEvent } from "./schema.js";

const SINCE = "2026-01-02T00:00:00.000Z";
const BEFORE = "2026-01-01T12:00:00.000Z";
const T1 = "2026-01-02T01:00:00.000Z";
const T2 = "2026-01-02T02:00:00.000Z";
const T3 = "2026-01-02T03:00:00.000Z";

/** A stored ledger event with the given kind, time and fields; the rest is the ledger's own. */
function event(
  input: Partial<LedgerEvent> & Pick<LedgerEvent, "kind" | "occurredAt">,
): LedgerEvent {
  return {
    schema: SCHEMA_VERSION,
    id: `${input.kind}-${input.occurredAt}`,
    recordedAt: input.occurredAt,
    source: "github",
    ...input,
  };
}

describe("ideaStates maps each ledger event to the idea state it sets", () => {
  it("keys each event to its idea, or to its issue or pull request, and names the state", () => {
    const events = [
      event({ kind: "idea.filed", idea: "0007", occurredAt: T1 }),
      event({
        kind: "issue.labelled",
        number: 7,
        label: "ready-for-agent",
        occurredAt: T1,
      }),
      event({
        kind: "issue.labelled",
        number: 7,
        label: "bug",
        occurredAt: T1,
      }),
      event({ kind: "pr.opened", idea: "#7", number: 12, occurredAt: T1 }),
      event({
        kind: "pr.linked",
        number: 12,
        session: "w",
        agent: "w",
        occurredAt: T1,
      }),
      event({
        kind: "pr.linked",
        number: 99,
        session: "w",
        agent: "w",
        occurredAt: T1,
      }),
      event({ kind: "send-back", number: 12, label: "reason", occurredAt: T2 }),
      event({
        kind: "decision.routed",
        idea: "0007",
        label: "question",
        occurredAt: T2,
      }),
      event({ kind: "pr.merged", idea: "#7", number: 12, occurredAt: T3 }),
      event({
        kind: "outcome",
        idea: "0007",
        number: 7,
        label: "outcome:confirmed",
        occurredAt: T3,
      }),
      event({
        kind: "session.result",
        session: "w",
        agent: "w",
        result: "done",
        occurredAt: T3,
      }),
      event({ kind: "tick.plan", idea: "0007", number: 3, occurredAt: T3 }),
    ];

    expect(ideaStates(events)).toStrictEqual([
      { idea: "0007", state: "filed", at: T1 },
      { idea: "#7", state: "approved", at: T1 },
      { idea: "#7", state: "pr-open", at: T1 },
      { idea: "#7", state: "pr-open", at: T1 },
      { idea: "#7", state: "sent-back", at: T2 },
      { idea: "0007", state: "reserved", at: T2 },
      { idea: "#7", state: "merged", at: T3 },
      { idea: "0007", state: "outcome:confirmed", at: T3 },
    ]);
  });
});

describe("ideaStates orders the states by when each event occurred", () => {
  it("orders the states by when each event occurred, not by the order the ledger lists them", () => {
    const events = [
      event({
        kind: "outcome",
        idea: "0007",
        label: "outcome:confirmed",
        occurredAt: T3,
      }),
      event({ kind: "idea.filed", idea: "0007", occurredAt: T1 }),
    ];

    expect(ideaStates(events).map((s) => s.state)).toStrictEqual([
      "filed",
      "outcome:confirmed",
    ]);
  });
});

describe("firstIdeaStateChange returns the first state change at or after the wait began", () => {
  it("returns the idea and its new state when the ledger shows a change after the wait began", () => {
    const events = [
      event({ kind: "pr.opened", idea: "#7", number: 12, occurredAt: BEFORE }),
      event({
        kind: "pr.linked",
        number: 12,
        session: "w",
        agent: "w",
        occurredAt: T1,
      }),
      event({ kind: "send-back", number: 12, label: "reason", occurredAt: T2 }),
    ];

    expect(firstIdeaStateChange(events, SINCE)).toStrictEqual({
      idea: "#7",
      state: "sent-back",
      at: T2,
    });
  });

  it("does not return for a state the idea was already in before the wait began", () => {
    const events = [
      event({
        kind: "issue.labelled",
        number: 7,
        label: "ready-for-agent",
        occurredAt: BEFORE,
      }),
      event({
        kind: "issue.labelled",
        number: 7,
        label: "ready-for-agent",
        occurredAt: T1,
      }),
    ];

    expect(firstIdeaStateChange(events, SINCE)).toBeUndefined();
  });

  it("returns a change to a state the idea was not in when the wait began, counting an event at the instant it began", () => {
    const events = [
      event({ kind: "idea.filed", idea: "0007", occurredAt: BEFORE }),
      event({
        kind: "outcome",
        idea: "0007",
        label: "outcome:confirmed",
        occurredAt: SINCE,
      }),
    ];

    expect(firstIdeaStateChange(events, SINCE)).toStrictEqual({
      idea: "0007",
      state: "outcome:confirmed",
      at: SINCE,
    });
  });
});

describe("firstIdeaStateChange picks the earliest change, and only the named idea's", () => {
  it("returns an idea whose first state is recorded after the wait began", () => {
    const events = [
      event({ kind: "idea.filed", idea: "0009", occurredAt: T1 }),
    ];

    expect(firstIdeaStateChange(events, SINCE)).toStrictEqual({
      idea: "0009",
      state: "filed",
      at: T1,
    });
  });

  it("returns the earliest change, by when it occurred, when several ideas change", () => {
    const events = [
      event({
        kind: "outcome",
        idea: "0007",
        label: "outcome:confirmed",
        occurredAt: T3,
      }),
      event({ kind: "idea.filed", idea: "0007", occurredAt: T1 }),
    ];

    expect(firstIdeaStateChange(events, SINCE)).toStrictEqual({
      idea: "0007",
      state: "filed",
      at: T1,
    });
  });

  it("returns only a change to the one named idea when it is given, and no other idea's", () => {
    const events = [
      event({ kind: "idea.filed", idea: "0007", occurredAt: T1 }),
      event({
        kind: "outcome",
        idea: "0008",
        label: "outcome:confirmed",
        occurredAt: T2,
      }),
    ];

    expect(firstIdeaStateChange(events, SINCE, "0008")).toStrictEqual({
      idea: "0008",
      state: "outcome:confirmed",
      at: T2,
    });
    expect(firstIdeaStateChange(events, SINCE, "0009")).toBeUndefined();
  });

  it("returns nothing when no state changed after the wait began", () => {
    const events = [
      event({ kind: "idea.filed", idea: "0007", occurredAt: BEFORE }),
    ];

    expect(firstIdeaStateChange(events, SINCE)).toBeUndefined();
    expect(firstIdeaStateChange([], SINCE)).toBeUndefined();
  });
});
