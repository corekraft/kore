// The handover count in the flow report: the main session's sends that name a handover
// reason, read over the window. Real modules; the events are fixtures.

import { describe, expect, it } from "vitest";
import type { HandoverReason, Kind, LedgerEvent } from "../ledger/index.js";

import { handoverCount } from "./handover-count.js";
import type { Span } from "./scope.js";

const DAY = 86_400_000;
/** The report window is the eleventh day, open at the start and closed at the end. */
const WINDOW: Span = [10 * DAY, 11 * DAY];

/** An event at `ms`; its id and times read back as `ms`. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "herdr",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

/** A send from the main session (no sender role) that names a handover reason. */
const handover = (ms: number, reason: HandoverReason) =>
  event(ms, "session.send", {
    pane: "w3:p9",
    agent: "image-trust-writer",
    handover: reason,
  });

const merged = (ms: number) => event(ms, "pr.merged", { number: 1 });

const MIN_MERGED = 2;
const COST = { minMergedChanges: MIN_MERGED };

/** Two merged changes inside the window, enough to read the count. */
const mergedInWindow = () => [merged(10 * DAY + 1), merged(10 * DAY + 2)];

describe("handoverCount counts the main session's handovers", () => {
  it("counts the main session's handover sends in the window, by reason, every reason a key", () => {
    const events = [
      ...mergedInWindow(),
      handover(10 * DAY + 10, "needs-info-idea"),
      handover(10 * DAY + 20, "needs-info-idea"),
      handover(10 * DAY + 30, "owner-request"),
    ];

    expect(handoverCount(events, WINDOW, COST)).toEqual({
      status: "ok",
      handovers: 3,
      merged: 2,
      byReason: {
        "reserved-item": 0,
        "needs-info-idea": 2,
        "third-send-back": 0,
        "owner-request": 1,
        "flag-activation": 0,
        "unmapped-message": 0,
      },
    });
  });
});

describe("handoverCount leaves out what is not a main-session handover", () => {
  it("does not count a send from a role session, even one that names a reason", () => {
    const roleSend = event(10 * DAY + 15, "session.send", {
      pane: "w3:p9",
      senderRole: "writer",
      senderName: "image-trust-writer",
      handover: "owner-request",
    });

    expect(
      handoverCount([...mergedInWindow(), roleSend], WINDOW, COST),
    ).toEqual({
      status: "insufficient",
      reason: "no handover reason recorded in the window",
    });
  });

  it("does not count a handover sent outside the window", () => {
    const events = [
      ...mergedInWindow(),
      handover(10 * DAY + 10, "reserved-item"),
      handover(9 * DAY, "reserved-item"),
      handover(11 * DAY, "reserved-item"),
    ];

    expect(handoverCount(events, WINDOW, COST)).toMatchObject({
      status: "ok",
      handovers: 1,
    });
  });
});

describe("handoverCount prints insufficient, never zero", () => {
  it("prints insufficient when no send in the window names a reason, and not for a plain send", () => {
    const plain = event(10 * DAY + 15, "session.send", {
      pane: "w3:p9",
      agent: "image-trust-writer",
    });

    expect(handoverCount([...mergedInWindow(), plain], WINDOW, COST)).toEqual({
      status: "insufficient",
      reason: "no handover reason recorded in the window",
    });
  });

  it("prints insufficient when no send in the window names a reason", () => {
    const events = [...mergedInWindow(), merged(10 * DAY + 3)];

    expect(handoverCount(events, WINDOW, COST)).toEqual({
      status: "insufficient",
      reason: "no handover reason recorded in the window",
    });
  });

  it("prints insufficient, never zero, when the window has fewer merged changes than the minimum", () => {
    const events = [
      merged(10 * DAY + 1),
      handover(10 * DAY + 10, "unmapped-message"),
    ];

    expect(handoverCount(events, WINDOW, COST)).toEqual({
      status: "insufficient",
      reason: `1 of ${MIN_MERGED} merged changes needed`,
    });
  });
});
