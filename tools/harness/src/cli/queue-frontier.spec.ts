import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaRepository, type IdeaRecord } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import {
  buildFrontier,
  buildQueue,
  readReadyIssues,
  ticketQueueOn,
  type Frontier,
} from "../queue/index.js";
import type { CommandContext } from "../runtime/index.js";
import { fakeLedger } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";
import { queueCommands } from "./queue-commands.js";

vi.mock("../idea/index.js");
vi.mock("./ledger-commands.js");
vi.mock("../queue/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../queue/index.js")>()),
  buildFrontier: vi.fn(),
  buildQueue: vi.fn(),
  readReadyIssues: vi.fn(),
  ticketQueueOn: vi.fn(),
}));

const ok = { code: 0, stderr: "" };

const FRONTIER: Frontier = {
  queue: [
    {
      kind: "send-back",
      pr: 50,
      count: 1,
      since: "2026-01-06T00:00:00Z",
    },
    {
      kind: "idea",
      idea: "0001",
      issue: 10,
      since: "2026-01-05T00:00:00Z",
      lane: "product",
      horizon: "next",
    },
    {
      kind: "ticket",
      issue: 20,
      since: "2026-01-07T00:00:00Z",
      lane: "harness",
      horizon: "none",
      labels: ["ready-for-agent", "harness"],
    },
  ],
  excluded: [{ issue: 30, reason: "assigned" }],
};

interface Setup {
  context: CommandContext;
  runs: { command: string; args: string[] }[];
  out: () => string;
  err: () => string;
}

function setup(options: { json?: boolean; explain?: string } = {}): Setup {
  const out: string[] = [];
  const err: string[] = [];
  const runs: { command: string; args: string[] }[] = [];
  const answers: Record<string, string> = {
    repo: '{"nameWithOwner":"corekraft/kore"}',
    pr: '[{"number":50,"headRefOid":"aaaaaaa999"}]',
  };
  const context: CommandContext = {
    json: options.json ?? false,
    options: options.explain === undefined ? {} : { explain: options.explain },
    deps: {
      runner: {
        run: (command: string, args: string[]) => {
          runs.push({ command, args });
          return Promise.resolve({
            ...ok,
            stdout: answers[args[0] ?? ""] ?? "",
          });
        },
      },
      clock: { now: () => new Date("2026-01-02T03:04:05.000Z") },
      fs: {},
      root: () => Promise.resolve("/repo"),
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    } as unknown as CommandContext["deps"],
  };
  return {
    context,
    runs,
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

const next = (c: CommandContext) => queueCommands["next"]?.run(c);

const ledger = fakeLedger([] as Partial<LedgerEvent>[]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ticketQueueOn).mockResolvedValue(true);
  vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
  vi.mocked(IdeaRepository).mockImplementation(function fakeRepository() {
    return { list: () => Promise.resolve([{ number: "0001" } as IdeaRecord]) };
  } as unknown as typeof IdeaRepository);
  vi.mocked(readReadyIssues).mockResolvedValue([]);
  vi.mocked(buildFrontier).mockReturnValue(FRONTIER);
});

describe("harness queue next with the tick-ticket-queue flag on", () => {
  it("builds the frontier from the ready search, the ideas, the open PRs and the send-back events", async () => {
    const issues = [{ number: 10 }];
    vi.mocked(readReadyIssues).mockResolvedValue(issues as never);
    await next(setup().context);
    expect(readReadyIssues).toHaveBeenCalledWith(
      expect.any(Function),
      "corekraft/kore",
    );
    expect(buildFrontier).toHaveBeenCalledWith({
      issues,
      ideas: [{ number: "0001" }],
      openPrs: [{ number: 50, head: "aaaaaaa999" }],
      sendBacks: [],
    });
    expect(buildQueue).not.toHaveBeenCalled();
  });

  it("reads the ready search through gh, so the search is the only issue read", async () => {
    const c = setup();
    vi.mocked(readReadyIssues).mockImplementation(async (run) => {
      await run(["api", "graphql"]);
      return [];
    });
    await next(c.context);
    expect(c.runs.map((r) => [r.command, ...r.args.slice(0, 2)])).toEqual([
      ["gh", "repo", "view"],
      ["gh", "api", "graphql"],
      ["gh", "pr", "list"],
    ]);
  });

  it("prints one numbered line per item in queue order, with its kind, lane and horizon", async () => {
    const c = setup();
    expect(await next(c.context)).toBe(0);
    expect(c.out()).toBe(
      [
        "1. send-back PR #50 lane - horizon - since 2026-01-06T00:00:00Z",
        "2. idea 0001 (issue #10) lane product horizon next since 2026-01-05T00:00:00Z",
        "3. ticket issue #20 lane harness horizon none since 2026-01-07T00:00:00Z",
        "",
      ].join("\n"),
    );
  });

  it("prints the queue and the excluded issues as JSON under --json", async () => {
    const c = setup({ json: true });
    await next(c.context);
    expect(c.out()).toBe(
      `${JSON.stringify({ queue: FRONTIER.queue, excluded: FRONTIER.excluded })}\n`,
    );
  });

  it("says the queue is empty when nothing is queued", async () => {
    vi.mocked(buildFrontier).mockReturnValue({ queue: [], excluded: [] });
    const c = setup();
    await next(c.context);
    expect(c.out()).toBe("The queue is empty.\n");
  });
});

describe("harness queue next --explain", () => {
  it("names an issue's place in the queue, its kind, lane and horizon", async () => {
    const c = setup({ explain: "20" });
    expect(await next(c.context)).toBe(0);
    expect(c.out()).toBe(
      "issue #20 is queued at position 3 of 3: ticket, lane harness, horizon none\n",
    );
  });

  it("names the reason an excluded issue is not queued", async () => {
    const c = setup({ explain: "30" });
    expect(await next(c.context)).toBe(0);
    expect(c.out()).toBe("issue #30 is excluded: it has an assignee\n");
  });

  it("says an issue that is not in the search lacks ready-for-agent or is not open", async () => {
    const c = setup({ explain: "99" });
    expect(await next(c.context)).toBe(0);
    expect(c.out()).toBe(
      "issue #99 is not queued: it lacks the ready-for-agent label, or is not open\n",
    );
  });

  it("explains in JSON under --json, with the status and the position or reason", async () => {
    const queued = setup({ explain: "20", json: true });
    await next(queued.context);
    expect(queued.out()).toBe(
      `${JSON.stringify({ issue: 20, status: "queued", position: 3, item: FRONTIER.queue[2] })}\n`,
    );
    const excluded = setup({ explain: "30", json: true });
    await next(excluded.context);
    expect(excluded.out()).toBe(
      `${JSON.stringify({ issue: 30, status: "excluded", reason: "assigned" })}\n`,
    );
  });

  it("refuses a value that is not an issue number, and names the command to run", async () => {
    const c = setup({ explain: "abc" });
    expect(await next(c.context)).toBe(1);
    expect(c.err()).toBe(
      "Missing or invalid issue number. Run `harness queue next --explain <issue>`.\n",
    );
    expect(buildFrontier).not.toHaveBeenCalled();
  });
});

describe("harness queue next --explain with the flag off", () => {
  it("refuses, naming the flag, and reads nothing from gh", async () => {
    vi.mocked(ticketQueueOn).mockResolvedValue(false);
    const c = setup({ explain: "20" });
    expect(await next(c.context)).toBe(1);
    expect(c.err()).toBe(
      "--explain needs the local tick-ticket-queue flag, which is off; run `harness queue next` without --explain, or ask the owner to turn the flag on.\n",
    );
    expect(c.runs).toEqual([]);
  });
});
