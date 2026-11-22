import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClock,
  fakeLedger,
  NOW,
  recordsEverything,
} from "./ledger-support.js";
import type { Terminal, Terminals } from "../terminal/index.js";
import { reconcileTerminals } from "./terminal-reconcile.js";
import { lastReadings, planTerminals } from "./terminal-watch.js";
import type { EventInput } from "./schema.js";

// The planner is a double here: its own spec reads what it plans (ADR 0098).
vi.mock("./terminal-watch.js", () => ({
  lastReadings: vi.fn(),
  planTerminals: vi.fn(),
}));

const LISTED: Terminal[] = [
  { id: "t2", state: "live", labels: { "kore-session": "s1" }, cwd: "/w" },
];
const FIRST: EventInput = {
  source: "terminal",
  kind: "pane.busy",
  occurredAt: NOW,
  pane: "t2",
  session: "s1",
  status: "working",
  turn: 0,
};
const SECOND: EventInput = { ...FIRST, pane: "t3" };

function setup() {
  const fake = fakeLedger();
  recordsEverything(fake.record);
  fake.list.mockResolvedValue({ events: [], skipped: 0 });
  const list = vi.fn(async () => LISTED);
  const terminals = { list } as unknown as Terminals;
  const clock = fakeClock();
  const run = () =>
    reconcileTerminals({ ledger: fake.ledger, terminals, clock });
  return { fake, list, run };
}

beforeEach(() => {
  vi.mocked(lastReadings).mockReturnValue(new Map());
  vi.mocked(planTerminals).mockReturnValue({ events: [], last: new Map() });
});

describe("reconcileTerminals: what it reads", () => {
  it("reads hc's listing of every terminal, and the ledger's terminal events, then plans from both", async () => {
    const { fake, list, run } = setup();
    const past = [FIRST];
    fake.list.mockResolvedValue({ events: past as never, skipped: 0 });
    await run();
    expect(list).toHaveBeenCalledWith();
    expect(fake.list).toHaveBeenCalledWith({ source: "terminal" });
    expect(lastReadings).toHaveBeenCalledWith(past);
    expect(planTerminals).toHaveBeenCalledWith(LISTED, new Map(), NOW);
  });
});

describe("reconcileTerminals: what it records", () => {
  it("records each planned event, in order, and reports how many it recorded", async () => {
    const { fake, run } = setup();
    vi.mocked(planTerminals).mockReturnValue({
      events: [FIRST, SECOND],
      last: new Map(),
    });
    expect(await run()).toEqual({ ok: true, recorded: 2 });
    expect(fake.record.mock.calls).toEqual([[FIRST], [SECOND]]);
  });

  it("records nothing and reports zero when the plan is empty", async () => {
    const { fake, run } = setup();
    expect(await run()).toEqual({ ok: true, recorded: 0 });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("stops at the first record the ledger refuses, and names its message", async () => {
    const { fake, run } = setup();
    vi.mocked(planTerminals).mockReturnValue({
      events: [FIRST, FIRST],
      last: new Map(),
    });
    fake.record.mockResolvedValueOnce({
      ok: false,
      field: "status",
      message: 'Invalid event: field "status" is refused.',
    });
    expect(await run()).toEqual({
      ok: false,
      message: 'Invalid event: field "status" is refused.',
    });
    expect(fake.record).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileTerminals: a listing hc refuses", () => {
  it("names hc's message and its hint, and records nothing", async () => {
    const { fake, list, run } = setup();
    list.mockResolvedValueOnce({
      error: {
        kind: "unavailable",
        message: "hc ls failed",
        hint: "check the pin",
      },
    } as never);
    expect(await run()).toEqual({
      ok: false,
      message: "hc ls failed (check the pin)",
    });
    expect(fake.record).not.toHaveBeenCalled();
  });
});
