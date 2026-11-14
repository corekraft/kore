import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOW,
  PATH,
  fakeClock,
  fakeFileSystem,
  fakeLedger,
  fakeRunner,
  ok,
  recordsEverything,
} from "./ledger-support.js";
import { heldLock } from "./github-poll-support.js";
import {
  SPAWN_AND_BUSY,
  isNameStub,
  listing,
  paneEvent,
  writer,
  type Agent,
} from "./herdr-poll-support.js";
import { acquire } from "./poll-lock.js";
import { pollHerdr } from "./herdr-poll.js";
import type { RecordResult } from "./ledger.js";
import { isName, type LedgerEvent } from "./schema.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./poll-lock.js", () => ({ acquire: vi.fn() }));
vi.mock("./schema.js", () => ({ isName: vi.fn() }));

const CMD = ["agent", "list"] as const;

/** One poll: herdr answers `stdout` as printed, and the ledger holds `events`. */
function setup(
  stdout: string,
  events: LedgerEvent[] = [],
  code = 0,
  stderr = "",
) {
  const runner = fakeRunner();
  runner.run.mockResolvedValue({ stdout, stderr, code });
  const fake = fakeLedger();
  fake.list.mockResolvedValue({ events, skipped: 0 });
  recordsEverything(fake.record);
  const fs = fakeFileSystem();
  const clock = fakeClock();
  const poll = () => pollHerdr({ ledger: fake.ledger, runner, clock, fs });
  return { runner, fake, fs, clock, poll };
}

/** A poll whose herdr lists `agents`. */
const setupAgents = (agents: Agent[], events: LedgerEvent[] = []) =>
  setup(ok(listing(agents)).stdout, events);

beforeEach(() => {
  vi.mocked(isName).mockImplementation(isNameStub);
  vi.mocked(acquire).mockResolvedValue(heldLock());
});

describe("pollHerdr: the lock", () => {
  it("polls under the ledger's lock file, beside the ledger", async () => {
    const { fs, clock, poll } = setupAgents([]);
    await poll();
    expect(vi.mocked(acquire)).toHaveBeenCalledWith(fs, clock, `${PATH}.lock`);
  });

  it("reports busy, and asks herdr nothing, when another poll holds the lock", async () => {
    const { runner, poll } = setupAgents([]);
    vi.mocked(acquire).mockResolvedValue({ ok: false, message: "held" });
    expect(await poll()).toEqual({ ok: false, message: "held" });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("releases the lock after a failed listing", async () => {
    const { poll } = setup("", [], 1, "no server");
    const held = heldLock();
    vi.mocked(acquire).mockResolvedValue(held);
    await poll();
    expect(held.release).toHaveBeenCalledTimes(1);
  });
});

describe("pollHerdr: a listing that fails", () => {
  it("names the exit code and herdr's own words, and records nothing", async () => {
    const { fake, runner, poll } = setup("", [], 1, "no server");
    expect(await poll()).toEqual({
      ok: false,
      message:
        "herdr agent list failed: exit code 1: no server. Is the herdr server running?",
    });
    expect(runner.run.mock.calls).toEqual([["herdr", CMD]]);
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("says to check the herdr version when the listing is not JSON", async () => {
    const { poll } = setup("agents: none");
    expect(await poll()).toEqual({
      ok: false,
      message:
        "herdr agent list did not print JSON. Run `herdr agent list` by hand and check the herdr version.",
    });
  });

  it("says the agent list is missing when the JSON has no .result.agents", async () => {
    const { poll } = setup('{"result":{}}');
    expect(await poll()).toEqual({
      ok: false,
      message:
        "herdr agent list printed no agent list (.result.agents); the herdr version may have changed its output.",
    });
  });
});

describe("pollHerdr: a pane first seen", () => {
  it("records it spawned, then its current status", async () => {
    const { fake, clock, poll } = setupAgents([writer("working")]);
    await poll();
    expect(fake.record.mock.calls).toEqual(SPAWN_AND_BUSY.map((e) => [e]));
    expect(clock.now).toHaveBeenCalled();
  });

  it("maps idle, blocked and done to waiting", async () => {
    const { fake, poll } = setupAgents([
      writer("idle", "w1:p1"),
      writer("blocked", "w1:p2"),
      writer("done", "w1:p3"),
    ]);
    await poll();
    expect(
      fake.record.mock.calls
        .map((c) => c[0])
        .filter((e) => e.kind === "pane.waiting")
        .map((e) => e.pane),
    ).toEqual(["w1:p1", "w1:p2", "w1:p3"]);
  });

  it("uses the agent type when the name is one the ledger refuses, and unknown when both are", async () => {
    vi.mocked(isName).mockImplementation(
      (value) => value !== "bad name" && isNameStub(value),
    );
    const { fake, poll } = setupAgents([
      {
        pane_id: "w1:p1",
        agent_status: "working",
        name: "bad name",
        agent: "codex",
      },
      { pane_id: "w1:p2", agent_status: "working", name: "bad name" },
    ]);
    await poll();
    expect(fake.record.mock.calls.map((c) => [c[0].pane, c[0].agent])).toEqual([
      ["w1:p1", "codex"],
      ["w1:p1", "codex"],
      ["w1:p2", "unknown"],
      ["w1:p2", "unknown"],
    ]);
  });

  it("drops a pane whose id the ledger refuses, but keeps it from counting as closed", async () => {
    vi.mocked(isName).mockImplementation((value) => value !== "bad pane");
    const { fake, poll } = setupAgents([writer("working", "bad pane")]);
    expect(await poll()).toEqual({ ok: true, recorded: 0, events: [] });
    expect(fake.record).not.toHaveBeenCalled();
  });
});

describe("pollHerdr: a pane already recorded", () => {
  it("records nothing when its status and agent are unchanged", async () => {
    const { fake, poll } = setupAgents(
      [writer("idle")],
      [paneEvent("pane.waiting", "w3:p74", "writer")],
    );
    expect(await poll()).toEqual({ ok: true, recorded: 0, events: [] });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("records only the new status when it changes", async () => {
    const { fake, poll } = setupAgents(
      [writer("idle")],
      [paneEvent("pane.busy", "w3:p74", "writer")],
    );
    await poll();
    expect(fake.record.mock.calls.map((c) => c[0].kind)).toEqual([
      "pane.waiting",
    ]);
  });

  it("closes the old agent and spawns the new one when a different agent lives there", async () => {
    const { fake, poll } = setupAgents(
      [
        {
          pane_id: "w3:p74",
          agent_status: "working",
          name: "other",
          agent: "codex",
        },
      ],
      [paneEvent("pane.busy", "w3:p74", "writer")],
    );
    await poll();
    expect(fake.record.mock.calls.map((c) => [c[0].kind, c[0].agent])).toEqual([
      ["pane.closed", "writer"],
      ["pane.spawned", "other"],
      ["pane.busy", "other"],
    ]);
  });

  it("does not close a pane it already closed", async () => {
    const { fake, poll } = setupAgents(
      [],
      [paneEvent("pane.closed", "w3:p74", "writer")],
    );
    expect(await poll()).toEqual({ ok: true, recorded: 0, events: [] });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("keeps a pane open when herdr lists it with a status the poll does not map", async () => {
    const { fake, poll } = setupAgents(
      [writer("starting")],
      [paneEvent("pane.busy", "w3:p74", "writer")],
    );
    expect(await poll()).toEqual({ ok: true, recorded: 0, events: [] });
    expect(fake.record).not.toHaveBeenCalled();
  });
});

describe("pollHerdr: a recorded pane that goes away", () => {
  it("closes a recorded pane that herdr no longer lists, under the agent it recorded", async () => {
    const { fake, poll } = setupAgents(
      [],
      [paneEvent("pane.waiting", "w3:p74", "writer")],
    );
    expect(await poll()).toEqual({
      ok: true,
      recorded: 1,
      events: [
        {
          source: "herdr",
          kind: "pane.closed",
          occurredAt: NOW,
          pane: "w3:p74",
          agent: "writer",
        },
      ],
    });
    expect(fake.record).toHaveBeenCalledTimes(1);
  });

  it("names an unrecorded agent unknown when it closes", async () => {
    const { fake, poll } = setupAgents([], [paneEvent("pane.busy", "w3:p74")]);
    await poll();
    expect(fake.record.mock.calls[0]?.[0]).toMatchObject({
      kind: "pane.closed",
      agent: "unknown",
    });
  });
});

describe("pollHerdr: reading the ledger and the result", () => {
  it("reads only herdr's events from the ledger", async () => {
    const { fake, poll } = setupAgents([]);
    await poll();
    expect(fake.list.mock.calls).toEqual([[{ source: "herdr" }]]);
  });

  it("returns the ledger's message when a record is refused", async () => {
    const { fake, poll } = setupAgents([writer("working")]);
    const refused: RecordResult = {
      ok: false,
      field: "pane",
      message: "bad pane",
    };
    fake.record.mockResolvedValue(refused);
    expect(await poll()).toEqual({ ok: false, message: "bad pane" });
  });

  it("counts and returns what it recorded", async () => {
    const { poll } = setupAgents([writer("working")]);
    expect(await poll()).toEqual({
      ok: true,
      recorded: 2,
      events: SPAWN_AND_BUSY,
    });
  });
});
