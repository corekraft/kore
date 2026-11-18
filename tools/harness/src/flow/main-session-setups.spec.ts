// The setup label of each main-session stretch (#1046, spec #1027): derived when the report
// reads, from the recorded model, the largest prompt and the compaction cap. Everything outside
// the unit is mocked (ADR 0098): the role check, the event time and the window test.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { mainSessionSetups } from "./main-session-setups.js";

const hasRole = vi.fn<(event: LedgerEvent) => boolean>();

vi.mock("./stage-of.js", () => ({ roleResolver: () => hasRole }));
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Date.parse(event.occurredAt),
}));
vi.mock("./scope.js", () => ({
  inWindow: (window: Span, at: number) => at >= window[0] && at < window[1],
}));

const WINDOW: Span = [1000, 2000];
const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-5-5";
const CAP = 80_000;

let counter = 0;

function ledgerEvent(
  ms: number,
  kind: Kind,
  session: string,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  counter += 1;
  return {
    schema: 1,
    id: `e${counter}`,
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    session,
    ...extra,
  } satisfies LedgerEvent;
}

const split = (
  ms: number,
  session: string,
  model: string,
  largestPrompt: number,
) => ledgerEvent(ms, "token.split", session, { model, largestPrompt });

beforeEach(() => {
  hasRole.mockReset();
  hasRole.mockReturnValue(false);
});

describe("mainSessionSetups labels each main-session stretch from recorded facts", () => {
  it("labels the main-session model with a largest prompt over the cap as control", () => {
    const events = [split(1500, "main", OPUS, CAP + 1)];

    expect(mainSessionSetups(events, WINDOW, CAP)).toEqual({
      status: "ok",
      compactionCap: CAP,
      stretches: [
        {
          session: "main",
          model: OPUS,
          largestPrompt: CAP + 1,
          label: "control",
        },
      ],
    });
  });

  it("labels the main-session model with a largest prompt exactly at the cap as early compaction", () => {
    const events = [split(1500, "main", OPUS, CAP)];

    const out = mainSessionSetups(events, WINDOW, CAP);

    expect(out.status === "ok" && out.stretches.map((s) => s.label)).toEqual([
      "early compaction",
    ]);
  });

  it("labels a Haiku stretch as Haiku whatever its largest prompt", () => {
    const events = [
      split(1500, "a", HAIKU, CAP + 1),
      split(1600, "b", HAIKU, 10),
    ];

    const out = mainSessionSetups(events, WINDOW, CAP);

    expect(out.status === "ok" && out.stretches.map((s) => s.label)).toEqual([
      "Haiku",
      "Haiku",
    ]);
  });

  it("labels a stretch not set, never control, early compaction or Haiku, when no cap is set", () => {
    const events = [
      split(1500, "a", OPUS, 900_000),
      split(1600, "b", OPUS, 10),
      split(1700, "c", HAIKU, 10),
    ];

    expect(mainSessionSetups(events, WINDOW, undefined)).toEqual({
      status: "ok",
      compactionCap: null,
      stretches: [
        { session: "a", model: OPUS, largestPrompt: 900_000, label: "not set" },
        { session: "b", model: OPUS, largestPrompt: 10, label: "not set" },
        { session: "c", model: HAIKU, largestPrompt: 10, label: "not set" },
      ],
    });
  });
});

describe("mainSessionSetups leaves a stretch it cannot label insufficient and skips other work", () => {
  it("labels a session with token totals and no split reading insufficient and names why", () => {
    const events = [ledgerEvent(1500, "token.usage", "bare", { tokens: 5000 })];

    expect(mainSessionSetups(events, WINDOW, CAP)).toEqual({
      status: "ok",
      compactionCap: CAP,
      stretches: [
        {
          session: "bare",
          model: null,
          largestPrompt: null,
          label: "insufficient",
          reason: "no token.split reading recorded for the session",
        },
      ],
    });
  });

  it("labels a session with token totals and no split reading insufficient even when no cap is set", () => {
    const events = [ledgerEvent(1500, "token.usage", "bare", { tokens: 5000 })];

    const out = mainSessionSetups(events, WINDOW, undefined);

    expect(out.status === "ok" && out.stretches).toEqual([
      {
        session: "bare",
        model: null,
        largestPrompt: null,
        label: "insufficient",
        reason: "no token.split reading recorded for the session",
      },
    ]);
  });

  it("labels a model that is neither Haiku nor the main-session model not set when no cap is set", () => {
    const events = [split(1500, "odd", "claude-fable-5-2", 10)];

    const out = mainSessionSetups(events, WINDOW, undefined);

    expect(out.status === "ok" && out.stretches).toEqual([
      {
        session: "odd",
        model: "claude-fable-5-2",
        largestPrompt: 10,
        label: "not set",
      },
    ]);
  });

  it("labels a model that is neither Haiku nor the main-session model insufficient", () => {
    const events = [split(1500, "odd", "claude-fable-5-2", 10)];

    const out = mainSessionSetups(events, WINDOW, CAP);

    expect(out.status === "ok" && out.stretches).toEqual([
      {
        session: "odd",
        model: "claude-fable-5-2",
        largestPrompt: 10,
        label: "insufficient",
        reason:
          "model claude-fable-5-2 is neither the main-session model nor Haiku",
      },
    ]);
  });
});

describe("mainSessionSetups chooses which readings make a stretch", () => {
  it("splits a session that changed model into one stretch per model, each with its own largest prompt", () => {
    const events = [
      split(1100, "mix", OPUS, CAP + 5),
      split(1200, "mix", OPUS, CAP + 9),
      split(1300, "mix", HAIKU, 30),
    ];

    const out = mainSessionSetups(events, WINDOW, CAP);

    expect(out.status === "ok" && out.stretches).toEqual([
      { session: "mix", model: OPUS, largestPrompt: CAP + 9, label: "control" },
      { session: "mix", model: HAIKU, largestPrompt: 30, label: "Haiku" },
    ]);
  });

  it("leaves out a session with a role, and a reading outside the window", () => {
    hasRole.mockImplementation((e) => e.session === "writer");
    const events = [
      split(1500, "writer", OPUS, 10),
      split(500, "early", OPUS, 10),
      split(2500, "late", OPUS, 10),
      split(1500, "main", OPUS, 10),
    ];

    const out = mainSessionSetups(events, WINDOW, CAP);

    expect(out.status === "ok" && out.stretches.map((s) => s.session)).toEqual([
      "main",
    ]);
  });

  it("is insufficient with its reason, never an empty list, when no main-session stretch is in the window", () => {
    expect(mainSessionSetups([], WINDOW, CAP)).toEqual({
      status: "insufficient",
      reason: "no main-session reading recorded in the window",
    });
  });
});
