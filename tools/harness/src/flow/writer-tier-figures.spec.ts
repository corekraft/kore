import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import {
  HAIKU,
  SONNET,
  WINDOW,
  event,
  launch,
  linked,
} from "./writer-cost-support.js";
import {
  firstPromptOf,
  tierJoinsIn,
  ownerMinutesIn,
  reworkSendsIn,
  requestSplitIn,
} from "./writer-tier-figures.js";

const MINUTE = 60_000;
/** A span wide enough to hold every event the rework and owner-minute fixtures place in it. */
const WIDE: [number, number] = [0, 60 * MINUTE];

/** A send to a writer pane, naming the session it went to. */
const send = (ms: number, agent: string, pane: string) =>
  event(ms, "session.send", { agent, pane });

/** A judge send-back of a pull request. */
const sendBack = (ms: number, number: number) =>
  event(ms, "send-back", { number });

/** A token.split reading of one model's cumulative request counts for a writer session. */
const split = (
  ms: number,
  agent: string,
  model: string,
  counts: {
    lowRequests?: number;
    highRequests?: number;
    firstPrompt?: number;
  } = {},
): LedgerEvent =>
  event(ms, "token.split", {
    agent,
    model,
    lowRequests: counts.lowRequests ?? 0,
    highRequests: counts.highRequests ?? 0,
    firstPrompt: counts.firstPrompt ?? 0,
    largestPrompt: 0,
    lowInput: 0,
    lowCacheWrite5m: 0,
    lowCacheWrite1h: 0,
    lowCacheRead: 0,
    lowOutput: 0,
    highInput: 0,
    highCacheWrite5m: 0,
    highCacheWrite1h: 0,
    highCacheRead: 0,
    highOutput: 0,
  });

describe("rework: a send to a writer pane after a send-back for its pull request", () => {
  // PR 100 is the haiku writer's change and PR 101 the sonnet writer's.
  const EVENTS = [
    launch(100, "h-writer", "w1:p1", HAIKU),
    launch(110, "s-writer", "w1:p2", SONNET),
    linked(200, 100, "h-writer"),
    linked(210, 101, "s-writer"),
    send(150, "h-writer", "w1:p1"), // before any send-back: not rework
    sendBack(300, 100),
    send(400, "h-writer", "w1:p1"), // after the send-back for PR 100: rework
    send(500, "h-writer", "w1:p1"), // every such send counts
    event(600, "pane.interrupted", { pane: "w1:p1" }), // an interrupt is not a send
    send(350, "s-writer", "w1:p2"), // PR 100's send-back is not the sonnet writer's PR
    sendBack(700, 101),
    send(800, "s-writer", "w1:p2"), // after the send-back for PR 101: rework
  ];

  it("counts each send after a send-back for the change its writer started, by that writer's tier", () => {
    expect(reworkSendsIn(EVENTS, WIDE)).toEqual(
      new Map([
        [HAIKU, 2],
        [SONNET, 1],
      ]),
    );
  });

  it("does not count a send that has no send-back before it, nor an interrupt", () => {
    const withoutSendBacks = EVENTS.filter((e) => e.kind !== "send-back");
    expect(reworkSendsIn(withoutSendBacks, WIDE)).toEqual(new Map());
  });
});

describe("owner minutes of a tier: owner actions on its joined pull requests", () => {
  it("counts the sittings on the joined changes only, a sitting ten minutes or more apart starting a new one", () => {
    const events = [
      launch(100, "h-writer", "w1:p1", HAIKU),
      linked(200, 100, "h-writer"),
      event(1000, "pr.merged", { number: 100 }),
      event(1100, "owner.action", { number: 100 }),
      event(1100 + MINUTE, "owner.action", { number: 100 }), // the same sitting: one minute
      event(1100 + 15 * MINUTE, "owner.action", { number: 100 }), // a new sitting: at least one minute
      event(1100, "owner.action", { number: 999 }), // not a joined change
    ];
    expect(ownerMinutesIn(events, WIDE, [100])).toBe(2);
  });

  it("is zero, a count rather than an unread figure, for a tier whose changes have no owner action", () => {
    expect(ownerMinutesIn([], WIDE, [100])).toBe(0);
  });
});

describe("requests over the 100K step: the tier's requests in the span", () => {
  it("counts the span's growth of each writer's requests, and reports a session with none over 100K as zero", () => {
    const events = [
      launch(100, "h-writer", "w1:p1", HAIKU),
      launch(100, "s-writer", "w1:p2", SONNET),
      split(500, "h-writer", HAIKU, { lowRequests: 5 }), // before the span: the start count
      split(1500, "h-writer", HAIKU, { lowRequests: 8, highRequests: 2 }),
      split(1200, "s-writer", SONNET, { lowRequests: 4 }), // no request over 100K
    ];
    const split_ = requestSplitIn(events, WINDOW);
    expect(split_.get(HAIKU)).toEqual({ requests: 5, over100k: 2 });
    expect(split_.get(SONNET)).toEqual({ requests: 4, over100k: 0 });
  });
});

describe("first-request prompt size: the earliest reading's first prompt", () => {
  it("reads the first request's prompt from the session's earliest reading, and nothing for a session with no reading", () => {
    const events = [
      split(2000, "a-writer", HAIKU, { firstPrompt: 120_000 }),
      split(1000, "a-writer", HAIKU, { firstPrompt: 90_000 }),
    ];
    expect(firstPromptOf(events, "a-writer")).toBe(90_000);
    expect(firstPromptOf(events, "unknown-writer")).toBeUndefined();
  });
});

describe("prompt figures of a tier: only the span's own writer sessions", () => {
  it("leaves out a writer launched before the span and a writer whose first reading is outside it", () => {
    const events = [
      // Launched before the span: its first request is not the span's.
      launch(500, "early-writer", "w0:p1", HAIKU),
      split(1500, "early-writer", HAIKU, {
        lowRequests: 1,
        firstPrompt: 90_000,
      }),
      // Launched in the span, but its earliest reading is before it: that first request is not the span's.
      launch(1100, "late-first-writer", "w0:p2", HAIKU),
      split(500, "late-first-writer", HAIKU, {
        lowRequests: 1,
        firstPrompt: 70_000,
      }),
      split(1500, "late-first-writer", HAIKU, {
        lowRequests: 2,
        firstPrompt: 120_000,
      }),
      // Launched and first read in the span: the only session the prompt figures read.
      launch(1200, "in-span-writer", "w0:p3", HAIKU),
      split(1600, "in-span-writer", HAIKU, {
        lowRequests: 1,
        firstPrompt: 100_000,
      }),
    ];
    const figures = tierJoinsIn(events, WINDOW, [HAIKU]).figures.get(HAIKU);
    expect(figures).toMatchObject({
      firstPromptP50: 100_000,
      firstPromptP90: 100_000,
    });
  });
});
