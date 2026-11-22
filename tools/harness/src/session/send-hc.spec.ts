import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { FakeTerminals, type TerminalError } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { recordTerminalEvent } from "./hc-ledger.js";
import type { SessionRecord } from "./registry.js";
import { sendHcCommand, sendOnHc } from "./send-hc.js";
import { FAILED, fail } from "./output.js";
import { contextOf } from "./deps-support.js";
import { reachOf } from "./send-hc-reach.js";

vi.mock("./hc-ledger.js", () => ({ recordTerminalEvent: vi.fn() }));
vi.mock("./send-hc-reach.js", () => ({ reachOf: vi.fn() }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn((_deps: unknown, _json: unknown, code: number) => code),
}));
vi.mock("./backend.js", () => ({
  hcMessage: vi.fn((error: TerminalError) => error.error.message),
}));

const MESSAGE = "Also check the cache rule";
let deps: FakeDeps;

/**
 * The world a send runs in: t1 is the main session (an agent that reports idle), t2 is the writer
 * (its child, in group pair-a), t3 its child reader, t4 a group sibling under t1, and t5 an
 * unrelated shell. The caller is t2 unless a spec says otherwise.
 */
async function world(options: { self?: string; parentIsAgent?: boolean } = {}) {
  const terminals = new FakeTerminals(
    options.self === undefined ? {} : { self: options.self },
  );
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  if (options.parentIsAgent !== false) {
    terminals.setStatus("t1", "idle");
  }
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
    labels: {
      "kore-session": "image-trust-writer",
      role: "writer",
      group: "pair-a",
    },
  });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/child",
    name: "child-reader",
    parent: "t2",
    labels: { "kore-session": "child-reader", role: "reader" },
  });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/sibling",
    name: "pair-a-reader",
    parent: "t1",
    labels: {
      "kore-session": "pair-a-reader",
      role: "reader",
      group: "pair-a",
    },
  });
  await terminals.run({
    argv: ["bash"],
    cwd: "/work/other",
    name: "other-shell",
  });
  return terminals;
}

/** A session record for the terminal it names; the record's name is the session name `session send` takes. */
function recordOf(name: string, terminal: string): SessionRecord {
  return {
    version: 1,
    backend: "hc",
    name,
    paneId: terminal,
    terminal,
    model: "claude-sonnet-5-5",
    role: "reader",
    effort: "high",
    createdAt: "2026-01-02T03:04:05.000Z",
  };
}

const recorded = vi.mocked(recordTerminalEvent);
const reach = vi.mocked(reachOf);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hcMessage).mockImplementation(
    (error: TerminalError) => error.error.message,
  );
  deps = fakeDeps();
  recorded.mockResolvedValue(undefined);
  reach.mockReturnValue("child");
});

describe("sendOnHc delivers to the caller's parent, child and group sibling", () => {
  it("sends the message to the parent when it is an agent, and records a session.send that names the caller", async () => {
    reach.mockReturnValue("parent");
    const terminals = await world({ self: "t2" });

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("main-session", "t1"),
      MESSAGE,
    );

    expect(result).toStrictEqual({ terminal: "t1", unrecorded: undefined });
    expect(terminals.sent("t1")).toStrictEqual([MESSAGE]);
    expect(recorded).toHaveBeenCalledWith(deps, {
      kind: "session.send",
      pane: "t1",
      agent: "main-session",
      senderRole: "writer",
      senderName: "image-trust-writer",
    });
  });

  it("sends the message to a child whose parent is the caller", async () => {
    reach.mockReturnValue("child");
    const terminals = await world({ self: "t2" });

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("child-reader", "t3"),
      MESSAGE,
    );

    expect(result).toStrictEqual({ terminal: "t3", unrecorded: undefined });
    expect(terminals.sent("t3")).toStrictEqual([MESSAGE]);
  });

  it("sends the message to a sibling that shares the caller's group label", async () => {
    reach.mockReturnValue("sibling");
    const terminals = await world({ self: "t2" });
    terminals.setStatus("t4", "idle");

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("pair-a-reader", "t4"),
      MESSAGE,
    );

    expect(result).toStrictEqual({ terminal: "t4", unrecorded: undefined });
    expect(terminals.sent("t4")).toStrictEqual([MESSAGE]);
  });
});

describe("sendOnHc refuses what the reach rule does not allow, and sends nothing", () => {
  it("refuses an unrelated terminal, names the reach rule, and records no event", async () => {
    reach.mockReturnValue(undefined);
    const terminals = await world({ self: "t2" });

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("other-shell", "t5"),
      MESSAGE,
    );

    expect(result).toStrictEqual({
      error:
        "Session other-shell is on terminal t5, which is not reachable from t2 (not its parent, a child, or a sibling in its group), so nothing was sent.",
    });
    expect(terminals.sent("t5")).toStrictEqual([]);
    expect(recorded).not.toHaveBeenCalled();
  });

  it("refuses a parent that is a delivery shell, since a message would type into its shell", async () => {
    reach.mockReturnValue("parent");
    const terminals = await world({ self: "t2", parentIsAgent: false });

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("main-session", "t1"),
      MESSAGE,
    );

    expect(result).toStrictEqual({
      error:
        "Session main-session's parent t1 reports no status, so it is not an agent (a shell): a message would be typed into that shell, so nothing was sent. Its report reaches it as a file, through session report.",
    });
    expect(terminals.sent("t1")).toStrictEqual([]);
    expect(recorded).not.toHaveBeenCalled();
  });

  it("refuses when the caller is not inside an hc terminal", async () => {
    const terminals = await world();

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("child-reader", "t3"),
      MESSAGE,
    );

    expect(result).toStrictEqual({
      error:
        "Not inside an hc terminal (HC_TERMINAL_ID is unset), so session send to child-reader was not sent. Run it from an hc terminal.",
    });
    expect(terminals.sent("t3")).toStrictEqual([]);
  });

  it("sends once and never resends blind when hc does not confirm, and says to read the terminal", async () => {
    const terminals = await world({ self: "t2" });
    terminals.finish("t3", 0);
    const sendSpy = vi.spyOn(terminals, "send");

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("child-reader", "t3"),
      MESSAGE,
    );

    expect(result).toStrictEqual({
      error:
        "Session child-reader was not confirmed: terminal t3 has finished. Nothing was resent. Read the terminal with hc read t3 before sending again.",
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(recorded).not.toHaveBeenCalled();
  });
});

describe("sendOnHc keeps a sent message whose ledger event could not be recorded", () => {
  it("reports the reason next to the terminal, and does not fail the send", async () => {
    const terminals = await world({ self: "t2" });
    recorded.mockResolvedValue(
      "cannot find the main checkout to keep the ledger in",
    );

    const result = await sendOnHc(
      deps as unknown as CliDeps,
      terminals,
      recordOf("child-reader", "t3"),
      MESSAGE,
    );

    expect(result).toStrictEqual({
      terminal: "t3",
      unrecorded: "cannot find the main checkout to keep the ledger in",
    });
    expect(terminals.sent("t3")).toStrictEqual([MESSAGE]);
  });
});

describe("sendHcCommand prints the send, or the reason it was refused", () => {
  it("prints the terminal it sent to, and exits 0", async () => {
    const terminals = await world({ self: "t2" });
    reach.mockReturnValue("child");

    const code = await sendHcCommand(
      contextOf(deps),
      terminals,
      recordOf("child-reader", "t3"),
      MESSAGE,
    );

    expect(code).toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Sent to child-reader (t3).\n",
    );
    expect(deps.stderr).not.toHaveBeenCalled();
  });

  it("prints the send as JSON with --json, naming the session and its terminal", async () => {
    const terminals = await world({ self: "t2" });
    reach.mockReturnValue("child");

    await sendHcCommand(
      contextOf(deps, { json: true }),
      terminals,
      recordOf("child-reader", "t3"),
      MESSAGE,
    );

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"name":"child-reader","terminal":"t3","sent":true}\n',
    );
  });

  it("says a send whose event was not recorded, and still exits 0", async () => {
    const terminals = await world({ self: "t2" });
    reach.mockReturnValue("child");
    recorded.mockResolvedValue(
      "cannot find the main checkout to keep the ledger in",
    );

    const code = await sendHcCommand(
      contextOf(deps),
      terminals,
      recordOf("child-reader", "t3"),
      MESSAGE,
    );

    expect(code).toBe(0);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "Sent, but the session.send event was not recorded: cannot find the main checkout to keep the ledger in.\n",
    );
  });

  it("fails through fail with the refusal, and exits 1", async () => {
    const terminals = await world({ self: "t2" });
    reach.mockReturnValue(undefined);

    const code = await sendHcCommand(
      contextOf(deps),
      terminals,
      recordOf("other-shell", "t5"),
      MESSAGE,
    );

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      FAILED,
      "Session other-shell is on terminal t5, which is not reachable from t2 (not its parent, a child, or a sibling in its group), so nothing was sent.",
    );
  });
});
