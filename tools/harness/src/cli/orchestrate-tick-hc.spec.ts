import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import {
  AttendedTerminal,
  TickReconcile,
  unsettledOf,
} from "../orchestrator/index.js";
import {
  SessionRegistry,
  readReport,
  reportPath,
  terminalsFor,
} from "../session/index.js";
import { hcAttended, hcReconcile } from "./orchestrate-tick-hc.js";

vi.mock("../orchestrator/index.js", () => ({
  AttendedTerminal: vi.fn(),
  TickReconcile: vi.fn(),
  unsettledOf: vi.fn(),
}));
const { openRegistry } = vi.hoisted(() => ({ openRegistry: vi.fn() }));
vi.mock("../session/index.js", () => ({
  SessionRegistry: { open: openRegistry },
  readReport: vi.fn(),
  reportPath: vi.fn(),
  terminalsFor: vi.fn(),
}));

const NOW = new Date("2026-11-22T10:00:00.000Z");
const MAIN = "/main";

const record = {
  name: "idea-0001-writer",
  paneId: "p",
  model: "m",
  role: "writer",
  effort: "high",
  createdAt: "t",
  backend: "hc",
  terminal: "t7",
};

interface Fake {
  registry: {
    all: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
  terminals: { list: ReturnType<typeof vi.fn> };
}

function deps(): CliDeps {
  return {
    fs: {} as FileSystem,
    runner: {},
    env: {},
    clock: { now: () => NOW },
  } as unknown as CliDeps;
}

/** Wires the session and orchestrator barrels to fakes, and returns them. */
function wire(): Fake {
  const fake: Fake = {
    registry: {
      all: vi.fn().mockResolvedValue({ records: [record], unreadable: [] }),
      read: vi.fn().mockResolvedValue(record),
      write: vi.fn().mockResolvedValue(undefined),
    },
    terminals: { list: vi.fn().mockResolvedValue([]) },
  };
  vi.clearAllMocks();
  vi.mocked(openRegistry).mockResolvedValue(
    fake.registry as unknown as SessionRegistry,
  );
  vi.mocked(terminalsFor).mockReturnValue(
    fake.terminals as unknown as Terminals,
  );
  vi.mocked(unsettledOf).mockReturnValue([
    { name: "idea-0001-writer", terminal: "t7", reportSeq: 1 },
  ]);
  return fake;
}

/** The ports hcReconcile hands the TickReconcile it builds. */
async function portsOf() {
  await hcReconcile(deps(), MAIN);
  return vi.mocked(TickReconcile).mock.calls[0]![0];
}

describe("hcReconcile: wiring", () => {
  beforeEach(() => {
    wire();
  });

  it("builds the reconcile over this checkout's main root", async () => {
    await hcReconcile(deps(), MAIN);

    expect(vi.mocked(TickReconcile)).toHaveBeenCalledWith(
      expect.any(Object),
      MAIN,
    );
  });

  it("reads the open records through the registry, and the listing through the Terminals port", async () => {
    const p = await portsOf();

    expect(await p.unsettled()).toEqual([
      { name: "idea-0001-writer", terminal: "t7", reportSeq: 1 },
    ]);
    expect(unsettledOf).toHaveBeenCalledWith([record]);
  });
});

describe("hcReconcile: reads and writes", () => {
  let fake: Fake;

  beforeEach(() => {
    fake = wire();
  });

  it("reads the terminals through the Terminals port, finished ones included", async () => {
    const p = await portsOf();
    await p.list();

    expect(fake.terminals.list).toHaveBeenCalledWith();
  });

  it("counts a report as unread only when its seq is above the one the wait consumed", async () => {
    vi.mocked(reportPath).mockReturnValue(
      "/wt/.kore/report/idea-0001-writer.json",
    );
    const p = await portsOf();
    const session = { name: "idea-0001-writer", terminal: "t7", reportSeq: 1 };

    vi.mocked(readReport).mockResolvedValueOnce({
      seq: 2,
      outcome: "done",
      summary: "s",
      at: "t",
    });
    expect(await p.reported(session, "/wt")).toBe(true);
    expect(reportPath).toHaveBeenCalledWith("/wt", "idea-0001-writer");

    vi.mocked(readReport).mockResolvedValueOnce({
      seq: 1,
      outcome: "done",
      summary: "s",
      at: "t",
    });
    expect(await p.reported(session, "/wt")).toBe(false);

    vi.mocked(readReport).mockResolvedValueOnce(undefined);
    expect(await p.reported(session, "/wt")).toBe(false);
  });

  it("records a block by writing the stored record with its result, keeping every other field", async () => {
    const p = await portsOf();
    await p.block(
      "idea-0001-writer",
      "lost with its parent: terminal t7 has finished",
    );

    expect(fake.registry.read).toHaveBeenCalledWith("idea-0001-writer");
    expect(fake.registry.write).toHaveBeenCalledWith({
      ...record,
      result: {
        outcome: "blocked",
        at: NOW.toISOString(),
        summary: "lost with its parent: terminal t7 has finished",
      },
    });
  });
});

describe("hcReconcile: a record that settled meanwhile", () => {
  it.each([
    [
      "has a result already",
      { result: { outcome: "done", at: "t", summary: "s" } },
    ],
    ["is closed", { closedAt: "t" }],
    ["consumed a report meanwhile", { reportSeq: 2 }],
  ])(
    "does not block a record that settled meanwhile: it %s",
    async (_why, settled) => {
      const own = wire();
      own.registry.read.mockResolvedValue({ ...record, ...settled });
      const p = await portsOf();

      expect(
        await p.block(
          "idea-0001-writer",
          "lost with its parent: terminal t7 has finished",
        ),
      ).toBe(false);
      expect(own.registry.write).not.toHaveBeenCalled();
    },
  );
});

describe("hcAttended", () => {
  it("finds the attended terminal and types into it over the hc Terminals port", async () => {
    const attended = {
      attendedPane: vi.fn().mockResolvedValue("t9"),
      send: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(AttendedTerminal).mockImplementation(function attendedFake() {
      return attended as unknown as AttendedTerminal;
    });
    const terminals = { list: vi.fn(), send: vi.fn() } as unknown as Terminals;
    vi.mocked(terminalsFor).mockReturnValue(terminals);

    const cli = deps();
    const ports = hcAttended(cli);

    expect(terminalsFor).toHaveBeenCalledWith(cli);
    expect(vi.mocked(AttendedTerminal)).toHaveBeenCalledWith(terminals);
    expect(await ports.attendedPane()).toBe("t9");
    expect(await ports.send("t9", "line")).toBeUndefined();
    expect(attended.send).toHaveBeenCalledWith("t9", "line");
  });
});
