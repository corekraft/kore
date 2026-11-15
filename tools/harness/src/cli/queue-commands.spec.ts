import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaRepository, type IdeaRecord } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import {
  buildQueue,
  countSendBacks,
  writerTier,
  type QueueItem,
} from "../queue/index.js";
import type { CommandContext } from "../runtime/index.js";
import { resolveTier } from "../session/index.js";
import { fakeLedger } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";
import { queueCommands } from "./queue-commands.js";

vi.mock("../idea/index.js");
vi.mock("../session/index.js");
vi.mock("./ledger-commands.js");
vi.mock("../queue/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../queue/index.js")>()),
  buildQueue: vi.fn(),
  countSendBacks: vi.fn(),
  writerTier: vi.fn(),
}));

const AT = "2026-01-02T03:04:05.000Z";
const ok = { code: 0, stderr: "" };

interface Run {
  command: string;
  args: string[];
}

function setup(
  options: {
    json?: boolean;
    operand?: string;
    answer?: (args: string[]) => {
      code: number;
      stdout: string;
      stderr: string;
    };
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const runs: Run[] = [];
  const answers: Record<string, string> = {
    repo: '{"nameWithOwner":"corekraft/kore"}',
    issue: '[{"number":10,"createdAt":"2026-01-05T00:00:00Z"},{"number":"x"}]',
    pr: '[{"number":50,"headRefOid":"aaaaaaa999"},{"number":"x"},7]',
  };
  const context: CommandContext = {
    json: options.json ?? false,
    options: {},
    operand: options.operand,
    deps: {
      runner: {
        run: (command: string, args: string[]) => {
          runs.push({ command, args });
          return Promise.resolve(
            options.answer?.(args) ?? {
              ...ok,
              stdout: answers[args[0] ?? ""] ?? "",
            },
          );
        },
      },
      clock: { now: () => new Date(AT) },
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

const run = (name: "next" | "send-backs" | "escalate", c: CommandContext) =>
  queueCommands[name]?.run(c);

const EVENTS = [{ id: "e" }] as LedgerEvent[];
const ITEMS: QueueItem[] = [
  { kind: "idea", idea: "0001", issue: 10, since: "2026-01-05T00:00:00Z" },
  { kind: "send-back", pr: 50, count: 1, since: "2026-01-06T00:00:00Z" },
];
let ledger: ReturnType<typeof fakeLedger>;

beforeEach(() => {
  vi.resetAllMocks();
  ledger = fakeLedger(EVENTS as Partial<LedgerEvent>[]);
  vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
  vi.mocked(IdeaRepository).mockImplementation(function fakeRepository() {
    return { list: () => Promise.resolve([{ number: "0001" } as IdeaRecord]) };
  } as unknown as typeof IdeaRepository);
  vi.mocked(buildQueue).mockReturnValue(ITEMS);
  vi.mocked(countSendBacks).mockReturnValue(1);
  vi.mocked(writerTier).mockImplementation((count, model) => ({
    model: count >= 2 ? "claude-sonnet-5-5" : model,
    escalate: count >= 2,
  }));
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-haiku-5-5",
    effort: "medium",
  });
});

describe("harness queue next", () => {
  it("passes approved issues, open PRs, ideas and send-back events to the queue and prints its answer as JSON", async () => {
    const c = setup({ json: true });
    expect(await run("next", c.context)).toBe(0);
    expect(buildQueue).toHaveBeenCalledWith({
      ideas: [{ number: "0001" }],
      approved: new Map([[10, "2026-01-05T00:00:00Z"]]),
      openPrs: [{ number: 50, head: "aaaaaaa999" }],
      sendBacks: EVENTS,
    });
    expect(ledger.list).toHaveBeenCalledWith({ kind: "send-back" });
    expect(c.out()).toBe(`${JSON.stringify({ queue: ITEMS })}\n`);
  });

  it("prints one line per item in plain text and says when the queue is empty", async () => {
    const c = setup();
    await run("next", c.context);
    expect(c.out()).toBe(
      "idea 0001 (issue #10) approved 2026-01-05T00:00:00Z\nsend-back on PR #50 (1 so far) since 2026-01-06T00:00:00Z\n",
    );
    vi.mocked(buildQueue).mockReturnValue([]);
    const empty = setup();
    await run("next", empty.context);
    expect(empty.out()).toBe("The queue is empty.\n");
  });

  it("only reads: every gh call is a list or a view, and nothing is recorded", async () => {
    const c = setup();
    await run("next", c.context);
    expect(c.runs.map((r) => [r.command, ...r.args.slice(0, 2)])).toEqual([
      ["gh", "repo", "view"],
      ["gh", "issue", "list"],
      ["gh", "pr", "list"],
    ]);
    expect(ledger.write).not.toHaveBeenCalled();
  });
});

describe("harness queue next failures", () => {
  it("fails naming gh's own error when it cannot list", async () => {
    const c = setup({
      answer: (args) =>
        args[0] === "issue"
          ? { code: 1, stdout: "", stderr: "auth required" }
          : { ...ok, stdout: '{"nameWithOwner":"corekraft/kore"}' },
    });
    expect(await run("next", c.context)).toBe(1);
    expect(c.err()).toBe(
      "gh issue list failed: auth required. Check `gh auth status`, then rerun.\n",
    );
    expect(c.out()).toBe("");
  });

  it("fails when gh returns something that is not a list", async () => {
    const c = setup({
      answer: (args) => ({
        ...ok,
        stdout: args[0] === "repo" ? '{"nameWithOwner":"o/r"}' : "not json",
      }),
    });
    expect(await run("next", c.context)).toBe(1);
    expect(c.err()).toBe(
      "gh returned unreadable issue list; rerun the command.\n",
    );
  });

  it("fails when gh cannot name the repository", async () => {
    const c = setup({ answer: () => ({ ...ok, stdout: "{}" }) });
    expect(await run("next", c.context)).toBe(1);
    expect(c.err()).toBe(
      "gh could not tell which repository this is; run it inside the repository.\n",
    );
  });

  it("fails with the ledger's own message when the ledger cannot be opened", async () => {
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger" });
    const c = setup();
    expect(await run("next", c.context)).toBe(1);
    expect(c.err()).toBe("no ledger\n");
  });

  it("rethrows an error it does not expect", async () => {
    vi.mocked(openLedger).mockRejectedValue(new Error("boom"));
    await expect(run("next", setup().context)).rejects.toThrow("boom");
  });
});

describe("harness queue send-backs", () => {
  it("reports the count and the writer's declared model below two", async () => {
    const c = setup({ operand: "50", json: true });
    expect(await run("send-backs", c.context)).toBe(0);
    expect(countSendBacks).toHaveBeenCalledWith(EVENTS, 50);
    expect(c.out()).toBe(
      `${JSON.stringify({ pr: 50, count: 1, model: "claude-haiku-5-5", escalate: false })}\n`,
    );
  });

  it("names Sonnet at two without reading the writer's definition", async () => {
    vi.mocked(countSendBacks).mockReturnValue(2);
    const c = setup({ operand: "50" });
    await run("send-backs", c.context);
    expect(resolveTier).not.toHaveBeenCalled();
    expect(c.out()).toBe(
      "PR #50: sent back 2 times; launch the writer on claude-sonnet-5-5\n",
    );
  });

  it("says 'time' for a single send-back", async () => {
    const c = setup({ operand: "50" });
    await run("send-backs", c.context);
    expect(c.out()).toBe(
      "PR #50: sent back 1 time; launch the writer on claude-haiku-5-5\n",
    );
  });

  it("fails with the tier error when the writer's model is not declared", async () => {
    vi.mocked(resolveTier).mockResolvedValue({ error: "no model" });
    const c = setup({ operand: "50" });
    expect(await run("send-backs", c.context)).toBe(1);
    expect(c.err()).toBe("no model\n");
  });

  it.each([undefined, "abc", "0", "-1"])(
    "refuses the PR operand %s",
    async (operand) => {
      const c = setup(operand === undefined ? {} : { operand });
      expect(await run("send-backs", c.context)).toBe(1);
      expect(c.err()).toBe(
        "Missing or invalid PR number. Run `harness queue send-backs <pr>`.\n",
      );
    },
  );
});

describe("harness queue escalate", () => {
  beforeEach(() => {
    vi.mocked(countSendBacks).mockReturnValue(2);
  });

  it("records one escalation event naming the Sonnet model once the PR was sent back twice", async () => {
    ledger.list.mockResolvedValue({ events: [], skipped: 0 });
    const c = setup({ operand: "50" });
    expect(await run("escalate", c.context)).toBe(0);
    expect(ledger.write).toHaveBeenCalledExactlyOnceWith({
      source: "github",
      kind: "escalation",
      occurredAt: AT,
      number: 50,
      label: "claude-sonnet-5-5",
    });
    expect(c.out()).toBe(
      "PR #50: escalation recorded; launch the writer with `session spawn --role writer --model claude-sonnet-5-5`\n",
    );
  });

  it("records nothing when the PR already has an escalation event", async () => {
    ledger.list.mockImplementation(({ kind }: { kind?: string } = {}) =>
      Promise.resolve({
        events:
          kind === "escalation" ? ([{ number: 50 }] as LedgerEvent[]) : EVENTS,
        skipped: 0,
      }),
    );
    const c = setup({ operand: "50", json: true });
    expect(await run("escalate", c.context)).toBe(0);
    expect(ledger.write).not.toHaveBeenCalled();
    expect(c.out()).toBe(
      `${JSON.stringify({ pr: 50, count: 2, model: "claude-sonnet-5-5", escalated: true })}\n`,
    );
  });

  it("refuses and records nothing below two send-backs", async () => {
    vi.mocked(countSendBacks).mockReturnValue(1);
    const c = setup({ operand: "50" });
    expect(await run("escalate", c.context)).toBe(1);
    expect(c.err()).toBe(
      "PR #50 was sent back 1 time; a writer escalates after 2. Relaunch it on its default model instead.\n",
    );
    expect(ledger.write).not.toHaveBeenCalled();
  });

  it("refuses with the count in the plural at zero send-backs", async () => {
    vi.mocked(countSendBacks).mockReturnValue(0);
    const c = setup({ operand: "50" });
    await run("escalate", c.context);
    expect(c.err()).toContain("was sent back 0 times;");
  });

  it("fails with the ledger's message when the event is rejected", async () => {
    ledger.list.mockResolvedValue({ events: [], skipped: 0 });
    ledger.write.mockResolvedValue({
      ok: false,
      field: "kind",
      message: "Invalid event.",
    });
    const c = setup({ operand: "50" });
    expect(await run("escalate", c.context)).toBe(1);
    expect(c.err()).toBe(
      "The escalation event was rejected: Invalid event. Fix the ledger, then rerun `harness queue escalate 50`.\n",
    );
  });
});
