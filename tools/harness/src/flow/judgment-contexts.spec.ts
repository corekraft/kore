import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import {
  JUDGMENT_CONTEXT_LIMIT,
  judgmentContexts,
} from "./judgment-contexts.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: [number, number] = [1_000, 2_000];
const PANE = "idea-7-judgment-r1";

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  };
}

/** A judgment pane's launch, as session spawn writes it. */
const launch = (ms: number, name: string, idea?: string): LedgerEvent =>
  event(ms, "session.launch", {
    agent: name,
    role: "judgment",
    ...(idea === undefined ? {} : { idea }),
  });

/** A token reading: the session's cumulative tokens so far. */
const reading = (ms: number, name: string, tokens: number): LedgerEvent =>
  event(ms, "token.usage", { agent: name, tokens });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([from, to], at) => at >= from && at < to,
  );
});

describe("judgmentContexts: the limit and the readings it judges", () => {
  it("sets the context limit at 60,000 tokens, as ADR 0121 does", () => {
    expect(JUDGMENT_CONTEXT_LIMIT).toBe(60_000);
  });

  it("lists a judgment pane above the limit with its idea and largest reading", () => {
    const events = [
      launch(1_100, PANE, "7"),
      reading(1_200, PANE, 50_000),
      reading(1_300, PANE, 70_000),
    ];

    expect(judgmentContexts(events, WINDOW)).toEqual({
      limit: 60_000,
      panes: 1,
      over: [{ session: PANE, idea: "7", tokens: 70_000 }],
    });
  });

  it("does not list a judgment pane at exactly the limit, since only tokens above it count", () => {
    const events = [launch(1_100, PANE), reading(1_200, PANE, 60_000)];

    expect(judgmentContexts(events, WINDOW)).toEqual({
      limit: 60_000,
      panes: 1,
      over: [],
    });
  });

  it("takes the largest reading in the window, so a pane's peak is never hidden by a later, smaller one", () => {
    const events = [
      launch(1_100, PANE),
      reading(1_200, PANE, 80_000),
      reading(1_400, PANE, 75_000),
    ];

    expect(judgmentContexts(events, WINDOW).over).toEqual([
      { session: PANE, idea: undefined, tokens: 80_000 },
    ]);
  });

  it("ignores readings after the window's end, so a later reading cannot land in an earlier range", () => {
    const events = [launch(1_100, PANE), reading(2_500, PANE, 90_000)];

    expect(judgmentContexts(events, WINDOW)).toEqual({
      limit: 60_000,
      panes: 0,
      over: [],
    });
  });

  it("does not count a judgment pane launched before the window, even with readings inside it", () => {
    const events = [launch(500, PANE), reading(1_200, PANE, 90_000)];

    expect(judgmentContexts(events, WINDOW)).toEqual({
      limit: 60_000,
      panes: 0,
      over: [],
    });
  });
});

describe("judgmentContexts: which panes count", () => {
  it("never lists a session that was launched as another role, however many tokens it spent", () => {
    const events = [
      event(1_100, "session.launch", {
        agent: "idea-7-writer",
        role: "writer",
      }),
      reading(1_200, "idea-7-writer", 200_000),
    ];

    expect(judgmentContexts(events, WINDOW)).toEqual({
      limit: 60_000,
      panes: 0,
      over: [],
    });
  });

  it("lists over-limit panes most tokens first", () => {
    const other = "idea-8-judgment-r1";
    const events = [
      launch(1_100, PANE, "7"),
      reading(1_200, PANE, 65_000),
      launch(1_150, other, "8"),
      reading(1_250, other, 80_000),
    ];

    expect(judgmentContexts(events, WINDOW).over).toEqual([
      { session: other, idea: "8", tokens: 80_000 },
      { session: PANE, idea: "7", tokens: 65_000 },
    ]);
  });

  it("counts only judgment panes that have a reading in the window", () => {
    const silent = "idea-9-judgment-r1";
    const events = [
      launch(1_100, PANE),
      reading(1_200, PANE, 10_000),
      launch(1_100, silent),
    ];

    expect(judgmentContexts(events, WINDOW)).toEqual({
      limit: 60_000,
      panes: 1,
      over: [],
    });
  });

  it("matches a reading to its pane by any of the names the pane carries", () => {
    const events = [
      launch(1_100, PANE),
      event(1_200, "token.usage", { pane: PANE, tokens: 70_000 }),
    ];

    expect(judgmentContexts(events, WINDOW).over).toEqual([
      { session: PANE, idea: undefined, tokens: 70_000 },
    ]);
  });

  it("ignores a token reading that carries no count", () => {
    const events = [
      launch(1_100, PANE),
      event(1_200, "token.usage", { agent: PANE }),
    ];

    expect(judgmentContexts(events, WINDOW)).toEqual({
      limit: 60_000,
      panes: 0,
      over: [],
    });
  });
});
