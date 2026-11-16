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
