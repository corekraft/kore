import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import { fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { send } from "./send.js";
import { sendHcCommand } from "./send-hc.js";

vi.mock("./send-hc.js", () => ({ sendHcCommand: vi.fn() }));
const open = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ SessionRegistry: { open } }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

const deps = {
  env: {},
  stdout: vi.fn(),
  stderr: vi.fn(),
  clock: { now: () => new Date("2026-11-15T12:00:00.000Z") },
} as unknown as CliDeps;
const ctx = (
  operand: string | undefined,
  message: string | undefined,
): CommandContext => ({
  json: false,
  deps,
  operand,
  options: message === undefined ? {} : { message },
});

const HC_RECORD = {
  version: 1,
  backend: "hc",
  name: "child-reader",
  paneId: "",
  terminal: "t3",
  model: "claude-sonnet-5-5",
  role: "reader",
  effort: "high",
  createdAt: "2026-11-15T11:00:00.000Z",
} as SessionRecord;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fail).mockImplementation((_d, _j, code) => code);
  vi.mocked(sendHcCommand).mockResolvedValue(0);
  open.mockResolvedValue({
    read: vi.fn().mockResolvedValue(HC_RECORD),
  } as unknown as SessionRegistry);
});

describe("session send to an hc session", () => {
  it("hands an hc record to sendHcCommand, with the trimmed message", async () => {
    const code = await send(ctx("child-reader", "  Check the cache rule  "));

    expect(code).toBe(0);
    expect(sendHcCommand).toHaveBeenCalledExactlyOnceWith(
      ctx("child-reader", "  Check the cache rule  "),
      expect.anything(),
      HC_RECORD,
      "Check the cache rule",
    );
  });

  it("refuses a message that spans lines, before it opens the registry", async () => {
    const code = await send(ctx("child-reader", "one\ntwo"));

    expect(code).toBe(2);
    expect(open).not.toHaveBeenCalled();
    expect(sendHcCommand).not.toHaveBeenCalled();
  });

  it("refuses a closed session, and sends nothing", async () => {
    open.mockResolvedValue({
      read: vi
        .fn()
        .mockResolvedValue({ ...HC_RECORD, closedAt: "2026-11-15T11:30:00Z" }),
    } as unknown as SessionRegistry);

    const code = await send(ctx("child-reader", "Check it"));

    expect(code).toBe(1);
    expect(sendHcCommand).not.toHaveBeenCalled();
  });

  it("refuses a record with no terminal id, naming the close that removes it", async () => {
    open.mockResolvedValue({
      read: vi.fn().mockResolvedValue({ ...HC_RECORD, terminal: undefined }),
    } as unknown as SessionRegistry);

    const code = await send(ctx("child-reader", "Check it"));

    expect(code).toBe(1);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      1,
      expect.stringContaining(
        "harness session close --force-record child-reader",
      ),
    );
    expect(sendHcCommand).not.toHaveBeenCalled();
  });
});
