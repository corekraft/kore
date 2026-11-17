import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaRepository } from "../idea/index.js";
import type { Kind } from "../ledger/index.js";
import { readActivePlans } from "../plan/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";
import { statusCommand } from "./status-command.js";

vi.mock("../idea/index.js", () => ({
  IdeaRepository: vi.fn(function fakeRepository() {
    return { list: vi.fn(() => Promise.resolve([])) };
  }),
}));
vi.mock("../plan/index.js");
vi.mock("./ledger-commands.js");

const ROOT = "/repo";
const NOW = new Date("2026-11-17T12:00:00.000Z");

const routed = (idea: string, label: string, occurredAt: string) => ({
  source: "claude" as const,
  kind: "decision.routed" as Kind,
  occurredAt,
  idea,
  label,
  route: "owner" as const,
  signal: "matched" as const,
});
const mark = (idea: string, occurredAt: string) => ({
  source: "claude" as const,
  kind: "decision.blocking" as Kind,
  occurredAt,
  idea,
});
const EVENTS = [
  routed("0008", "destruction", "2026-11-17T10:00:00.000Z"),
  routed("0009", "credentials", "2026-11-17T11:00:00.000Z"),
  mark("0009", "2026-11-17T11:30:00.000Z"),
];

function run(events: object[], json = false) {
  vi.mocked(openLedger).mockResolvedValue({
    ledger: fakeLedger(events as never[]).ledger,
  });
  const stdout = vi.fn<(text: string) => void>();
  const clock = { now: vi.fn(() => NOW), sleep: vi.fn() };
  const context = contextWith(
    { root: vi.fn(() => Promise.resolve(ROOT)), fs: {}, clock, stdout },
    {},
    json,
  );
  return { context, stdout };
}

function printed(stdout: ReturnType<typeof vi.fn<(text: string) => void>>) {
  return stdout.mock.calls.map(([text]) => text).join("");
}

beforeEach(() => {
  vi.mocked(readActivePlans).mockResolvedValue([]);
  vi.mocked(IdeaRepository).mockClear();
});

describe("harness status and the owner's questions", () => {
  it("lists the open owner questions in json, blocking first", async () => {
    const f = run(EVENTS, true);

    expect(await statusCommand.run(f.context)).toBe(0);

    expect(JSON.parse(printed(f.stdout)).ownerQuestions).toEqual([
      {
        idea: "0009",
        category: "credentials",
        since: "2026-11-17T11:00:00.000Z",
        blocking: true,
      },
      {
        idea: "0008",
        category: "destruction",
        since: "2026-11-17T10:00:00.000Z",
        blocking: false,
      },
    ]);
  });

  it("prints the owner questions in text after the idea counts, blocking first and marked", async () => {
    const f = run(EVENTS);

    await statusCommand.run(f.context);

    expect(printed(f.stdout)).toBe(
      "Ideas: none\nOwner questions: 2 open, 1 blocking\n- idea 0009 (credentials), asked 2026-11-17T11:00:00.000Z, blocking\n- idea 0008 (destruction), asked 2026-11-17T10:00:00.000Z\n",
    );
  });

  it("prints no owner-question line when the only route is the advisor's", async () => {
    const advised = {
      ...routed("0010", "naming", "2026-11-17T10:00:00.000Z"),
      route: "advisor" as const,
    };
    const f = run([advised]);

    await statusCommand.run(f.context);

    expect(printed(f.stdout)).toBe("Ideas: none\n");
  });
});
