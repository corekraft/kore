import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClock,
  fakeLedger,
  NOW,
  recordsEverything,
} from "./ledger-support.js";
import type { Terminal, TerminalEvent, Terminals } from "../terminal/index.js";
import { followTerminals } from "./terminal-follow.js";
import { reconcileTerminals } from "./terminal-reconcile.js";
import { lastReadings, planTerminals } from "./terminal-watch.js";

// The reconcile and the planner are doubles here: their own specs cover them (ADR 0098).
vi.mock("./terminal-reconcile.js", () => ({ reconcileTerminals: vi.fn() }));
vi.mock("./terminal-watch.js", () => ({
  lastReadings: vi.fn(),
  planTerminals: vi.fn(),
}));

const TERMINAL: Terminal = {
  id: "t2",
  state: "live",
  labels: { "kore-session": "s1" },
  cwd: "/w",
  status: "working",
  turn: 0,
};

/** An event stream that yields these events, then ends (or throws, when given an error). */
function streamOf(events: TerminalEvent[], fails?: Error) {
  return (async function* () {
    yield* events;
    if (fails !== undefined) {
      throw fails;
    }
  })();
}

function setup(events: () => AsyncIterable<TerminalEvent>) {
  const fake = fakeLedger();
  recordsEverything(fake.record);
  fake.list.mockResolvedValue({ events: [], skipped: 0 });
  const get = vi.fn(
    async (_id: string) =>
      TERMINAL as Terminal | { error: { kind: string; message: string } },
  );
  const eventsSpy = vi.fn(events);
  const terminals = { get, events: eventsSpy } as unknown as Terminals;
  const clock = fakeClock();
  const run = () => followTerminals({ ledger: fake.ledger, terminals, clock });
  return { fake, get, terminals, eventsSpy, run };
}

const RECORD = {
  source: "terminal" as const,
  kind: "pane.busy" as const,
  occurredAt: NOW,
  pane: "t2",
  session: "s1",
  status: "working" as const,
  turn: 0,
};

beforeEach(() => {
  vi.mocked(reconcileTerminals).mockResolvedValue({ ok: true, recorded: 0 });
  vi.mocked(lastReadings).mockReturnValue(new Map());
  vi.mocked(planTerminals).mockReturnValue({ events: [], last: new Map() });
});

describe("followTerminals: the reconcile comes first", () => {
  it("reconciles before it starts to follow, so the gap is recorded before any new event", async () => {
    const { eventsSpy, run } = setup(() => streamOf([]));
    await run();
    expect(
      vi.mocked(reconcileTerminals).mock.invocationCallOrder[0],
    ).toBeLessThan(eventsSpy.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("follows nothing, and ends with the reconcile's message, when the reconcile fails", async () => {
    vi.mocked(reconcileTerminals).mockResolvedValueOnce({
      ok: false,
      message: "hc ls failed",
    });
    const { eventsSpy, run } = setup(() => streamOf([]));
    expect(await run()).toEqual({ ok: false, message: "hc ls failed" });
    expect(eventsSpy).not.toHaveBeenCalled();
  });
});

describe("followTerminals: each event", () => {
  it("reads the event's terminal with get, and records the reading the planner plans", async () => {
    vi.mocked(planTerminals).mockReturnValueOnce({
      events: [RECORD],
      last: new Map(),
    });
    const { fake, get, run } = setup(() =>
      streamOf([{ kind: "changed", terminal: "t2" }]),
    );
    await run();
    expect(get).toHaveBeenCalledWith("t2");
    expect(planTerminals).toHaveBeenCalledWith([TERMINAL], new Map(), NOW);
    expect(fake.record.mock.calls).toEqual([[RECORD]]);
  });

  it("carries each terminal's reading from one event to the next", async () => {
    const after = new Map([["t2", { status: "working" as const, turn: 0 }]]);
    vi.mocked(planTerminals)
      .mockReturnValueOnce({ events: [], last: after })
      .mockReturnValueOnce({ events: [], last: after });
    const { run } = setup(() =>
      streamOf([
        { kind: "changed", terminal: "t2" },
        { kind: "changed", terminal: "t2" },
      ]),
    );
    await run();
    expect(vi.mocked(planTerminals).mock.calls[1]?.[1]).toBe(after);
  });

  it("skips an event for a terminal removed since, and keeps following", async () => {
    vi.mocked(planTerminals).mockReturnValueOnce({
      events: [RECORD],
      last: new Map(),
    });
    const { fake, get, run } = setup(() =>
      streamOf([
        { kind: "finished", terminal: "gone" },
        { kind: "changed", terminal: "t2" },
      ]),
    );
    get.mockResolvedValueOnce({
      error: { kind: "not-found", message: "no terminal gone" },
    });
    await run();
    expect(fake.record.mock.calls).toEqual([[RECORD]]);
  });

  it("ends with hc's message when a read of a terminal fails for another reason", async () => {
    const { get, run } = setup(() =>
      streamOf([{ kind: "changed", terminal: "t2" }]),
    );
    get.mockResolvedValueOnce({
      error: { kind: "unavailable", message: "hc get failed" },
    });
    expect(await run()).toEqual({ ok: false, message: "hc get failed" });
  });
});

describe("followTerminals: errors that are not the stream's", () => {
  it("rethrows an error from recording a reading, since only the stream's own failure is reported as a message", async () => {
    vi.mocked(planTerminals).mockReturnValueOnce({
      events: [RECORD],
      last: new Map(),
    });
    const { fake, run } = setup(() =>
      streamOf([{ kind: "changed", terminal: "t2" }]),
    );
    fake.record.mockRejectedValueOnce(new Error("EACCES: ledger is read-only"));
    await expect(run()).rejects.toThrow("EACCES: ledger is read-only");
  });

  it("rethrows an error from reading a terminal, since get is not the stream", async () => {
    const { get, run } = setup(() =>
      streamOf([{ kind: "changed", terminal: "t2" }]),
    );
    get.mockRejectedValueOnce(new Error("socket reset"));
    await expect(run()).rejects.toThrow("socket reset");
  });
});

describe("followTerminals: the end of the stream", () => {
  it("ends ok when hc's stream ends, so the watch can be started again", async () => {
    const { run } = setup(() => streamOf([]));
    expect(await run()).toEqual({ ok: true });
  });

  it("ends with the message of a stream that fails", async () => {
    const { run } = setup(() =>
      streamOf([], new Error("hc events printed a line that is not an event")),
    );
    expect(await run()).toEqual({
      ok: false,
      message: "hc events printed a line that is not an event",
    });
  });
});
