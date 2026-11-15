import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../ledger/index.js";
import {
  mainRoot,
  type CliDeps,
  type CommandContext,
} from "../runtime/index.js";
import { deliver } from "./notify.js";
import { fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { send } from "./send.js";

vi.mock("./notify.js", () => ({ deliver: vi.fn() }));
const open = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ SessionRegistry: { open } }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn(),
}));
vi.mock("./follow-up-prefix.js", () => ({
  FOLLOW_UP_PREFIX: "[tag]",
  withFollowUpPrefix: vi.fn((m: string) => `[tag] ${m}`),
}));
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
const out: string[] = [];
const append = vi.fn();
const deps = {
  stdout: (t: string) => out.push(t),
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
  vi.resetAllMocks();
  vi.mocked(fail).mockImplementation((_d, _j, code) => code);
  vi.mocked(mainRoot).mockResolvedValue("/repo");
  vi.mocked(deliver).mockResolvedValue(undefined);
  open.mockResolvedValue({
    read: vi.fn().mockResolvedValue(record),
  } as unknown as SessionRegistry);
  vi.mocked(Ledger).mockImplementation(function () {
    return { record: append } as unknown as Ledger;
  });
  append.mockResolvedValue({ ok: true });
});

describe("session send", () => {
  it("delivers the prefixed message to the named session's pane", async () => {
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      deps,
      "w3:p9",
      "[tag] Rebase",
    );
    expect(out).toEqual(["Sent to image-trust-writer (w3:p9).\n"]);
  });

  it("reports the send as JSON", async () => {
    await send(ctx("image-trust-writer", "Rebase", true));
    expect(out).toEqual([
      `${JSON.stringify({ name: "image-trust-writer", pane: "w3:p9", sent: true })}\n`,
    ]);
  });

  it("records one session.send stage event for the target after delivery", async () => {
    await send(ctx("image-trust-writer", "Rebase"));
    expect(append).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "session.send",
      occurredAt: NOW.toISOString(),
      pane: "w3:p9",
      agent: "image-trust-writer",
    });
  });

  it("records nothing when delivery fails, and reports the failure", async () => {
    vi.mocked(deliver).mockResolvedValue("not confirmed");
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(1);
    expect(failure()).toBe("not confirmed");
    expect(append).not.toHaveBeenCalled();
  });

  it("still succeeds when the ledger cannot be written", async () => {
    append.mockRejectedValue(new Error("disk full"));
    expect(await send(ctx("image-trust-writer", "Rebase"))).toBe(0);
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
