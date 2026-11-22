import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../ledger/index.js";
import {
  mainRoot,
  type CliDeps,
  type CommandContext,
} from "../runtime/index.js";
import { signedMessage } from "../sender/index.js";
import { deliver } from "./notify.js";
import { fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { send } from "./send.js";
import { sendHcCommand } from "./send-hc.js";
import { signedMainSendsOn } from "./signed-sends.js";

vi.mock("./notify.js", () => ({ deliver: vi.fn() }));
vi.mock("./send-hc.js", () => ({ sendHcCommand: vi.fn() }));
vi.mock("./signed-sends.js", () => ({ signedMainSendsOn: vi.fn() }));
const open = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ SessionRegistry: { open } }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn(),
}));
vi.mock("../sender/index.js", () => ({ signedMessage: vi.fn() }));
vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/ledger.jsonl",
  Ledger: vi.fn(),
}));
vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

const record = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  closedAt: undefined,
} as unknown as SessionRecord;
const NOW = new Date("2026-11-15T12:00:00.000Z");
const WRITER_SENDER = {
  command: "session send",
  session: { role: "writer", name: "pane-message-sender" },
};
const WRITER_LINE = "sender: writer pane-message-sender (session send): Rebase";
const out: string[] = [];
const err: string[] = [];
const append = vi.fn();
const env: Record<string, string | undefined> = {};
const deps = {
  env,
  stdout: (t: string) => out.push(t),
  stderr: (t: string) => err.push(t),
  clock: { now: () => NOW },
} as unknown as CliDeps;
const ctx = (
  operand: string | undefined,
  message: string | undefined,
  json = false,
): CommandContext => ({
  json,
  deps,
  operand,
  options: message === undefined ? {} : { message },
});
const failure = () => vi.mocked(fail).mock.calls[0]?.[3];

beforeEach(() => {
  out.length = 0;
  err.length = 0;
  vi.resetAllMocks();
  for (const key of Object.keys(env)) {
    delete env[key];
  }
  Object.assign(env, {
    KORE_ROLE: "writer",
    KORE_AGENT: "pane-message-sender",
  });
  vi.mocked(fail).mockImplementation((_d, _j, code) => code);
  vi.mocked(mainRoot).mockResolvedValue("/repo");
  vi.mocked(deliver).mockResolvedValue(undefined);
  vi.mocked(signedMainSendsOn).mockResolvedValue(false);
  vi.mocked(signedMessage).mockReturnValue({
    body: WRITER_LINE,
    sender: WRITER_SENDER,
  });
  open.mockResolvedValue({
    read: vi.fn().mockResolvedValue(record),
  } as unknown as SessionRegistry);
  vi.mocked(Ledger).mockImplementation(function () {
    return { record: append } as unknown as Ledger;
  });
  append.mockResolvedValue({ ok: true, event: {} });
});

describe("session send", () => {
  it("delivers the sender line and the message, signed from the caller's environment", async () => {
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
    expect(signedMessage).toHaveBeenCalledExactlyOnceWith(
      deps.env,
      "session send",
      "Rebase",
    );
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      deps,
      "w3:p9",
      WRITER_LINE,
      {
        rejoinWrapped: false,
      },
    );
    expect(out).toEqual(["Sent to image-trust-writer (w3:p9).\n"]);
  });

  it("never sends the fixed [orchestrator] prefix", async () => {
    vi.mocked(signedMessage).mockReturnValue({
      body: WRITER_LINE,
      sender: WRITER_SENDER,
    });
    await send(ctx("image-trust-writer", "Rebase"));
    expect(vi.mocked(deliver).mock.calls[0]?.[2]).not.toContain(
      "[orchestrator]",
    );
  });

  it("reports the send as JSON", async () => {
    await send(ctx("image-trust-writer", "Rebase", true));
    expect(out).toEqual([
      `${JSON.stringify({ name: "image-trust-writer", pane: "w3:p9", sent: true })}\n`,
    ]);
  });

  it("records one session.send stage event for the target, with the sender's role and name", async () => {
    await send(ctx("image-trust-writer", "Rebase"));
    expect(append).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "session.send",
      occurredAt: NOW.toISOString(),
      pane: "w3:p9",
      agent: "image-trust-writer",
      senderRole: "writer",
      senderName: "pane-message-sender",
    });
  });

  it("records no sender role or name for a send from the main session, which names neither", async () => {
    vi.mocked(signedMessage).mockReturnValue({
      body: "sender: the main session (session send): Rebase",
      sender: { command: "session send" },
    });
    await send(ctx("image-trust-writer", "Rebase"));
    const event = append.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(event).not.toHaveProperty("senderRole");
    expect(event).not.toHaveProperty("senderName");
    expect(event).toMatchObject({
      kind: "session.send",
      agent: "image-trust-writer",
    });
  });

  it("records nothing when delivery fails, and reports the failure", async () => {
    vi.mocked(deliver).mockResolvedValue("not confirmed");
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(1);
    expect(failure()).toBe("not confirmed");
    expect(append).not.toHaveBeenCalled();
  });
});

describe("session send confirms a wrapped line only behind signed-main-sends", () => {
  it("passes the wrapped-line rule to delivery while the flag is on", async () => {
    vi.mocked(signedMainSendsOn).mockResolvedValue(true);
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      deps,
      "w3:p9",
      WRITER_LINE,
      { rejoinWrapped: true },
    );
  });

  it("passes the line-by-line rule to delivery while the flag is off", async () => {
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      deps,
      "w3:p9",
      WRITER_LINE,
      { rejoinWrapped: false },
    );
  });
});

describe("session send refusals", () => {
  it("refuses a message the sender line cannot be written for, and touches no pane", async () => {
    vi.mocked(signedMessage).mockReturnValue({
      error:
        "KORE_AGENT is not set, so the sender line cannot name the session.",
    });
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(1);
    expect(failure()).toBe(
      "KORE_AGENT is not set, so the sender line cannot name the session.",
    );
    expect(open).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    ["no name", undefined, "Rebase"],
    ["no message", "image-trust-writer", undefined],
    ["a blank message", "image-trust-writer", "   "],
    ["a message with a line break", "image-trust-writer", "a\nb"],
  ])("refuses %s before touching any pane", async (_n, name, message) => {
    expect(await send(ctx(name, message))).toBe(2);
    expect(failure()).toContain("session send <name> --message");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("refuses an unknown session and names the fix", async () => {
    open.mockResolvedValue({
      read: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionRegistry);
    expect(await send(ctx("ghost", "Rebase"))).toBe(1);
    expect(failure()).toContain("No session named ghost");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("refuses a closed session", async () => {
    open.mockResolvedValue({
      read: vi
        .fn()
        .mockResolvedValue({ ...record, closedAt: "2026-11-15T00:00:00.000Z" }),
    } as unknown as SessionRegistry);
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(1);
    expect(failure()).toContain("is closed");
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("session send when the event is not recorded", () => {
  const warned = () => err.join("");
  const RECORD =
    "harness ledger record --source herdr --kind session.send --pane w3:p9 --agent image-trust-writer";

  it("warns with the cause and the record command when the write fails, and still exits 0", async () => {
    append.mockRejectedValue(
      Object.assign(new Error("no space left"), { code: "ENOSPC" }),
    );
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
    expect(out).toEqual(["Sent to image-trust-writer (w3:p9).\n"]);
    expect(warned()).toBe(
      `Sent, but the session.send event was not recorded: no space left. Record it with \`${RECORD}\`.\n`,
    );
  });

  it("warns with the schema's message when the ledger rejects the event", async () => {
    append.mockResolvedValue({
      ok: false,
      field: "pane",
      message: 'Invalid event: field "pane" is bad.',
    });
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
    expect(warned()).toContain(
      'not recorded: Invalid event: field "pane" is bad.',
    );
  });

  it("warns when the main checkout cannot be found", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
    expect(warned()).toContain("not recorded: cannot find the main checkout");
    expect(append).not.toHaveBeenCalled();
  });

  it("says nothing on stderr when the event is recorded", async () => {
    await send(ctx("image-trust-writer", "Rebase"));
    expect(warned()).toBe("");
  });

  it("rethrows an error that is not a ledger write failure", async () => {
    append.mockRejectedValue(new TypeError("bug"));
    await expect(send(ctx("image-trust-writer", "Rebase"))).rejects.toThrow(
      "bug",
    );
  });
});

describe("session send to an hc session", () => {
  const HC_RECORD = {
    version: 1,
    backend: "hc",
    name: "child-reader",
    paneId: "t3",
    terminal: "t3",
    model: "claude-sonnet-5-5",
    role: "reader",
    effort: "high",
    createdAt: "2026-01-02T03:04:05.000Z",
  } as unknown as SessionRecord;

  it("hands an hc record to sendHcCommand, with the trimmed message, and never delivers to a pane", async () => {
    open.mockResolvedValue({
      read: vi.fn().mockResolvedValue(HC_RECORD),
    } as unknown as SessionRegistry);
    vi.mocked(sendHcCommand).mockResolvedValue(0);

    const code = await send(ctx("child-reader", "  Check the cache rule  "));

    expect(code).toBe(0);
    expect(sendHcCommand).toHaveBeenCalledExactlyOnceWith(
      ctx("child-reader", "  Check the cache rule  "),
      expect.anything(),
      HC_RECORD,
      "Check the cache rule",
    );
    expect(deliver).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});
