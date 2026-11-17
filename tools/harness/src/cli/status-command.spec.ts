import { describe, expect, it, vi } from "vitest";
import { IdeaRepository, type IdeaRecord } from "../idea/index.js";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { readActivePlans, type ActivePlan } from "../plan/index.js";
import { CommandError } from "../runtime/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";
import { statusCommand } from "./status-command.js";

const { list } = vi.hoisted(() => ({
  list: vi.fn<() => Promise<IdeaRecord[]>>(),
}));

vi.mock("../idea/index.js", () => ({
  IdeaRepository: vi.fn(function fakeRepository() {
    return { list };
  }),
}));
vi.mock("../plan/index.js");
vi.mock("./ledger-commands.js");

const ROOT = "/repo";

function idea(number: string, title: string, outcome?: string): IdeaRecord {
  return {
    number,
    slug: "slug",
    path: `docs/ideas/${number}-slug.md`,
    title,
    summary: "",
    hypothesis: "",
    expectedOutcome: "",
    measurement: "",
    safetyPattern: "",
    date: "2026-01-01",
    ...(outcome === undefined ? {} : { outcome }),
  };
}

function github(
  kind: Kind,
  occurredAt: string,
  extra: Partial<LedgerEvent> = {},
): Partial<LedgerEvent> {
  return { source: "github", kind, occurredAt, ...extra };
}

const PLAN: ActivePlan = {
  file: "infra/plans/5-a.md",
  name: "5-a",
  default: false,
  open: [{ step: "Step 1", count: 2 }],
  next: null,
  upcoming: [],
};

/** A command context over fake deps, with the ledger, plans and ideas the spec names. */
function fixture(
  options: {
    events?: Partial<LedgerEvent>[];
    skipped?: number;
    ideas?: IdeaRecord[];
    plans?: ActivePlan[];
    json?: boolean;
  } = {},
) {
  const ledger = fakeLedger(options.events ?? [], undefined, options.skipped);
  vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
  list.mockResolvedValue(options.ideas ?? []);
  vi.mocked(readActivePlans).mockResolvedValue(options.plans ?? []);
  const stdout = vi.fn<(text: string) => void>();
  const fs = {};
  const clock = { now: vi.fn(), sleep: vi.fn() };
  const context = contextWith(
    { root: vi.fn(() => Promise.resolve(ROOT)), fs, clock, stdout },
    {},
    options.json ?? false,
  );
  return { context, stdout, fs, clock };
}

function printed(stdout: ReturnType<typeof vi.fn<(text: string) => void>>) {
  return stdout.mock.calls.map(([text]) => text).join("");
}

describe("harness status --json", () => {
  it("reports open plan items and ideas by state, with each idea listed", async () => {
    const f = fixture({
      json: true,
      plans: [PLAN],
      ideas: [
        idea("0001", "Open one"),
        idea("0002", "Won", "success"),
        idea("0003", "Lost", "failure"),
      ],
    });
    expect(await statusCommand.run(f.context)).toBe(0);
    expect(JSON.parse(printed(f.stdout))).toMatchObject({
      plans: [PLAN],
      ideas: {
        byState: { open: 1, success: 1, failure: 1 },
        items: [
          { number: "0001", title: "Open one", state: "open" },
          { number: "0002", title: "Won", state: "success" },
          { number: "0003", title: "Lost", state: "failure" },
        ],
      },
    });
  });

  it("reports the github events as stages, newest first, with their number", async () => {
    const f = fixture({
      json: true,
      events: [
        github("issue.opened", "2026-01-01T00:00:00Z", { number: 7 }),
        github("pr.opened", "2026-01-02T00:00:00Z", { number: 8 }),
        github("outcome", "2026-01-04T00:00:00Z", { number: 7 }),
      ],
    });
    await statusCommand.run(f.context);
    expect(JSON.parse(printed(f.stdout)).ledger.recent).toEqual([
      {
        occurredAt: "2026-01-04T00:00:00Z",
        stage: "outcome",
        kind: "outcome",
        number: 7,
      },
      {
        occurredAt: "2026-01-02T00:00:00Z",
        stage: "merge",
        kind: "pr.opened",
        number: 8,
      },
      {
        occurredAt: "2026-01-01T00:00:00Z",
        stage: "await approval",
        kind: "issue.opened",
        number: 7,
      },
    ]);
  });
});

describe("harness status --json ledger stages", () => {
  it("limits the recent stages to the newest ten, newest first", async () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      github(
        "pr.opened",
        `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        {
          number: i + 1,
        },
      ),
    );
    const f = fixture({ json: true, events });
    await statusCommand.run(f.context);
    const recent = JSON.parse(printed(f.stdout)).ledger.recent as {
      number: number;
    }[];
    expect(recent.map((r) => r.number)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
  });

  it("drops a stage an agent reports about itself, since only github events map to a stage", async () => {
    const f = fixture({
      json: true,
      events: [
        {
          source: "claude",
          kind: "session.start",
          occurredAt: "2026-01-05T00:00:00Z",
          stage: "merge",
        },
        {
          source: "claude",
          kind: "pr.opened",
          occurredAt: "2026-01-02T00:00:00Z",
          number: 9,
        },
        github("pr.opened", "2026-01-01T00:00:00Z", { number: 8 }),
      ],
    });
    await statusCommand.run(f.context);
    expect(JSON.parse(printed(f.stdout)).ledger.recent).toEqual([
      {
        occurredAt: "2026-01-01T00:00:00Z",
        stage: "merge",
        kind: "pr.opened",
        number: 8,
      },
    ]);
  });

  it("passes the ledger's skipped-line count through", async () => {
    const f = fixture({ json: true, skipped: 2 });
    await statusCommand.run(f.context);
    expect(JSON.parse(printed(f.stdout)).ledger.skipped).toBe(2);
  });
});

describe("harness status --json empty sections", () => {
  it("reports empty sections when there is no plan, idea or ledger event", async () => {
    const f = fixture({ json: true });
    expect(await statusCommand.run(f.context)).toBe(0);
    expect(JSON.parse(printed(f.stdout))).toEqual({
      plans: [],
      ideas: { byState: {}, items: [] },
      ledger: { recent: [], skipped: 0 },
      tick: { state: "none" },
      ownerQuestions: [],
    });
  });

  it("reads the ideas from the repository at the resolved root", async () => {
    const f = fixture({ json: true });
    await statusCommand.run(f.context);
    expect(IdeaRepository).toHaveBeenCalledWith(f.fs, f.clock, ROOT);
  });
});

describe("harness status text", () => {
  it("prints each plan's open steps, the idea counts and the recent stages", async () => {
    const f = fixture({
      plans: [PLAN],
      ideas: [idea("0001", "Open one"), idea("0002", "Won", "success")],
      events: [github("pr.opened", "2026-01-02T00:00:00Z", { number: 8 })],
    });
    expect(await statusCommand.run(f.context)).toBe(0);
    expect(printed(f.stdout)).toBe(
      "infra/plans/5-a.md: Step 1 (2)\nIdeas: 1 open, 1 success\n2026-01-02T00:00:00Z merge pr.opened\n",
    );
  });

  it("says no open items, and none for ideas, when there are none", async () => {
    const f = fixture({ plans: [{ ...PLAN, open: [] }] });
    await statusCommand.run(f.context);
    expect(printed(f.stdout)).toBe(
      "infra/plans/5-a.md: no open items\nIdeas: none\n",
    );
  });

  it("fails with the ledger's error as a command error, listing nothing", async () => {
    const f = fixture({ plans: [PLAN] });
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger here" });
    await expect(statusCommand.run(f.context)).rejects.toThrow(
      new CommandError("no ledger here"),
    );
    expect(f.stdout).not.toHaveBeenCalled();
  });
});

describe("harness status and the tick heartbeat", () => {
  const NOW = new Date("2026-11-16T12:00:00.000Z");
  const tickEvent = (kind: string, occurredAt: string) => ({
    source: "claude" as const,
    kind: kind as Kind,
    occurredAt,
  });

  it("says in text that the tick is not running when its heartbeat has gone quiet", async () => {
    const f = fixture({
      events: [tickEvent("tick.started", "2026-11-16T11:00:00.000Z")],
    });
    f.clock.now.mockReturnValue(NOW);
    expect(await statusCommand.run(f.context)).toBe(0);
    expect(printed(f.stdout)).toBe(
      "Ideas: none\nthe tick is not running: no heartbeat since 2026-11-16T11:00:00.000Z\n",
    );
  });

  it("reports the tick as not running in json, with the last heartbeat's time", async () => {
    const f = fixture({
      json: true,
      events: [tickEvent("tick.started", "2026-11-16T11:00:00.000Z")],
    });
    f.clock.now.mockReturnValue(NOW);
    await statusCommand.run(f.context);
    expect(JSON.parse(printed(f.stdout)).tick).toEqual({
      state: "gap",
      lastAt: "2026-11-16T11:00:00.000Z",
    });
  });

  it("says nothing about the tick while its heartbeat is recent", async () => {
    const f = fixture({
      events: [tickEvent("tick.started", "2026-11-16T11:59:30.000Z")],
    });
    f.clock.now.mockReturnValue(NOW);
    await statusCommand.run(f.context);
    expect(printed(f.stdout)).toBe("Ideas: none\n");
  });

  it("says nothing about the tick after it stopped on its own, so a stop is not read as a gap", async () => {
    const f = fixture({
      events: [
        tickEvent("tick.started", "2026-11-16T10:00:00.000Z"),
        tickEvent("tick.stopped", "2026-11-16T10:30:00.000Z"),
      ],
    });
    f.clock.now.mockReturnValue(NOW);
    await statusCommand.run(f.context);
    expect(printed(f.stdout)).toBe("Ideas: none\n");
  });
});
