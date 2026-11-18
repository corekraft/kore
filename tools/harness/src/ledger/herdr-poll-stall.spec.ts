import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOW,
  fakeClock,
  fakeFileSystem,
  fakeLedger,
  fakeRunner,
  ok,
  recordsEverything,
} from "./ledger-support.js";
import { heldLock } from "./github-poll-support.js";
import { isNameStub, listing, writer } from "./herdr-poll-support.js";
import { acquire } from "./poll-lock.js";
import { pollHerdr } from "./herdr-poll.js";
import { isName, type LedgerEvent } from "./schema.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./poll-lock.js", () => ({ acquire: vi.fn() }));
vi.mock("./schema.js", () => ({ isName: vi.fn() }));

const MINUTE = 60_000;

/** A pane event on w3:p74 by the writer agent, `minutes` from the poll's clock. */
function spawned(minutes: number, kind: string): LedgerEvent {
  const occurredAt = new Date(Date.parse(NOW) + minutes * MINUTE).toISOString();
  return {
    id: `${kind}-${minutes}`,
    source: "herdr",
    kind,
    occurredAt,
    pane: "w3:p74",
    agent: "writer",
    schema: 1,
    recordedAt: occurredAt,
  } as LedgerEvent;
}

/** One poll with herdr showing the writer `status`, and the ledger holding `events`. */
function pollWith(status: string, events: LedgerEvent[]) {
  const runner = fakeRunner();
  runner.run.mockResolvedValue(ok(listing([writer(status)])));
  const fake = fakeLedger();
  fake.list.mockResolvedValue({ events, skipped: 0 });
  recordsEverything(fake.record);
  return pollHerdr({
    ledger: fake.ledger,
    runner,
    clock: fakeClock(),
    fs: fakeFileSystem(),
  });
}

beforeEach(() => {
  vi.mocked(isName).mockImplementation(isNameStub);
  vi.mocked(acquire).mockResolvedValue(heldLock());
});

describe("pollHerdr: a spawned pane gone idle", () => {
  it("records a pane.stalled once its spawned pane has been idle past five minutes", async () => {
    expect(
      await pollWith("idle", [
        spawned(-10, "session.launch"),
        spawned(-9, "pane.busy"),
        spawned(-8, "pane.waiting"),
      ]),
    ).toEqual({
      ok: true,
      recorded: 1,
      events: [
        {
          source: "herdr",
          kind: "pane.stalled",
          occurredAt: NOW,
          pane: "w3:p74",
          agent: "writer",
        },
      ],
    });
  });

  it("records nothing for an idle pane under five minutes", async () => {
    expect(
      await pollWith("idle", [
        spawned(-10, "session.launch"),
        spawned(-9, "pane.busy"),
        spawned(-2, "pane.waiting"),
      ]),
    ).toEqual({ ok: true, recorded: 0, events: [] });
  });
});

/** The reserved question the writer posted from w3:p74 on issue 854, `minutes` from the poll's clock. */
function posted(minutes: number): LedgerEvent {
  const occurredAt = new Date(Date.parse(NOW) + minutes * MINUTE).toISOString();
  return {
    schema: 1,
    id: `routed-${minutes}`,
    recordedAt: occurredAt,
    source: "claude",
    kind: "decision.routed",
    occurredAt,
    pane: "w3:p74",
    idea: "0009",
    label: "naming",
    route: "owner",
    signal: "reserved-category",
    number: 854,
  } as LedgerEvent;
}

/** The owner's untagged reply on issue 854, `minutes` from the poll's clock. */
function ownerReply(minutes: number): LedgerEvent {
  const occurredAt = new Date(Date.parse(NOW) + minutes * MINUTE).toISOString();
  return {
    schema: 1,
    id: `replied-${minutes}`,
    recordedAt: occurredAt,
    source: "github",
    kind: "owner.replied",
    occurredAt,
    number: 854,
  } as LedgerEvent;
}

/** One poll over `events` with herdr showing the writer idle, returning the poll and every ledger filter it asked for. */
async function pollOver(events: LedgerEvent[]) {
  const runner = fakeRunner();
  runner.run.mockResolvedValue(ok(listing([writer("idle")])));
  const fake = fakeLedger();
  fake.list.mockResolvedValue({ events, skipped: 0 });
  recordsEverything(fake.record);
  const result = await pollHerdr({
    ledger: fake.ledger,
    runner,
    clock: fakeClock(),
    fs: fakeFileSystem(),
  });
  return { result, filters: fake.list.mock.calls.map(([filter]) => filter) };
}

const IDLE_PANE = [
  spawned(-10, "session.launch"),
  spawned(-9, "pane.busy"),
  spawned(-8, "pane.waiting"),
];

describe("pollHerdr: the scheduled poll only reads herdr", () => {
  it("records the stall, and runs `herdr agent list` alone: no pane is closed, restarted or messaged", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValue(ok(listing([writer("idle")])));
    const fake = fakeLedger();
    fake.list.mockResolvedValue({
      events: [
        spawned(-10, "session.launch"),
        spawned(-9, "pane.busy"),
        spawned(-8, "pane.waiting"),
      ],
      skipped: 0,
    });
    recordsEverything(fake.record);

    const result = await pollHerdr({
      ledger: fake.ledger,
      runner,
      clock: fakeClock(),
      fs: fakeFileSystem(),
    });

    expect(result).toMatchObject({ ok: true, recorded: 1 });
    expect(runner.run.mock.calls).toEqual([["herdr", ["agent", "list"]]]);
  });
});

describe("pollHerdr: a waiting pane with a reserved question", () => {
  it("records nothing while the pane waits on the owner's answer to a question it posted", async () => {
    expect(await pollOver([...IDLE_PANE, posted(-7)])).toEqual({
      result: { ok: true, recorded: 0, events: [] },
      filters: expect.any(Array),
    });
  });

  it("records the pane.stalled once the owner has replied on the question's issue", async () => {
    const { result } = await pollOver([
      ...IDLE_PANE,
      posted(-7),
      ownerReply(-6),
    ]);
    expect(result).toMatchObject({ ok: true, recorded: 1 });
  });

  it("reads the question kinds from the ledger, and never asks for token usage", async () => {
    const tokens = {
      schema: 1,
      id: "token-1",
      recordedAt: NOW,
      source: "claude",
      kind: "token.usage",
      occurredAt: new Date(Date.parse(NOW) - MINUTE).toISOString(),
      session: "s1",
      pane: "w3:p74",
      tokens: 1000,
    } as LedgerEvent;
    const { result, filters } = await pollOver([...IDLE_PANE, tokens]);
    expect(filters).toContainEqual({ kind: "decision.routed" });
    expect(filters).toContainEqual({ kind: "owner.replied" });
    expect(filters).not.toContainEqual({ kind: "token.usage" });
    expect(result).toMatchObject({ ok: true, recorded: 1 });
  });
});
