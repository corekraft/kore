import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { FakeTerminals, type TerminalError } from "../terminal/index.js";
import {
  fakeDeps,
  fakeRegistry,
  asRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { recordTerminalEvent } from "./hc-ledger.js";
import { closeHcSession, closeOnHc } from "./close-hc.js";
import { FAILED, fail } from "./output.js";
import { contextOf } from "./deps-support.js";
import type { SessionRecord } from "./registry.js";

vi.mock("./hc-ledger.js", () => ({ recordTerminalEvent: vi.fn() }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn((_deps: unknown, _json: unknown, code: number) => code),
}));
vi.mock("./backend.js", () => ({
  hcMessage: vi.fn((error: TerminalError) => error.error.message),
}));

const CLOSED_AT = "2026-01-02T03:04:05.000Z";
const RECORD: SessionRecord = {
  version: 1,
  backend: "hc",
  name: "image-trust-writer",
  paneId: "t2",
  terminal: "t2",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: CLOSED_AT,
};

let deps: FakeDeps;
let registry: FakeRegistry;

/**
 * t1 is the main session, the caller of most specs. t2 is its child, the writer the record names.
 * t3 is a child of t2: another session's terminal. t4 is a shell with no parent at all.
 */
async function world(self: string | undefined): Promise<FakeTerminals> {
  const terminals = new FakeTerminals(self === undefined ? {} : { self });
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
  });
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/child",
    name: "child-reader",
    parent: "t2",
  });
  await terminals.run({
    argv: ["bash"],
    cwd: "/work/other",
    name: "other-shell",
  });
  return terminals;
}

const recorded = vi.mocked(recordTerminalEvent);

beforeEach(() => {
  vi.resetAllMocks();
  deps = fakeDeps();
  registry = fakeRegistry();
  recorded.mockResolvedValue(undefined);
  registry.write.mockResolvedValue(undefined);
});

describe("closeOnHc kills, records, then removes a terminal its caller spawned", () => {
  it("kills the child, writes its pane.closed event, removes it, and marks the record closed, in that order", async () => {
    const terminals = await world("t1");
    const kill = vi.spyOn(terminals, "kill");
    const remove = vi.spyOn(terminals, "remove");

    const result = await closeOnHc(
      deps as unknown as CliDeps,
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(result).toStrictEqual({ closedAt: CLOSED_AT });
    expect(kill).toHaveBeenCalledExactlyOnceWith("t2");
    expect(recorded).toHaveBeenCalledExactlyOnceWith(deps, {
      kind: "pane.closed",
      pane: "t2",
      agent: "image-trust-writer",
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith("t2");
    expect(kill.mock.invocationCallOrder[0]).toBeLessThan(
      recorded.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(recorded.mock.invocationCallOrder[0]).toBeLessThan(
      remove.mock.invocationCallOrder[0] ?? -1,
    );
    expect(registry.write).toHaveBeenCalledWith({
      ...RECORD,
      closedAt: CLOSED_AT,
    });
    expect(await terminals.get("t2")).toStrictEqual({
      error: {
        kind: "not-found",
        message: "no terminal t2",
        hint: "check the id with list()",
      },
    });
  });

  it("does not kill a child that already finished, but still records and removes it", async () => {
    const terminals = await world("t1");
    terminals.finish("t2", 0);
    const kill = vi.spyOn(terminals, "kill");

    const result = await closeOnHc(
      deps as unknown as CliDeps,
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(result).toStrictEqual({ closedAt: CLOSED_AT });
    expect(kill).not.toHaveBeenCalled();
    expect(recorded).toHaveBeenCalledTimes(1);
  });
});

describe("closeOnHc refuses a terminal the caller did not spawn, and closes nothing", () => {
  it("refuses another session's terminal, whose parent is not the caller", async () => {
    const terminals = await world("t1");
    const kill = vi.spyOn(terminals, "kill");
    const remove = vi.spyOn(terminals, "remove");

    const result = await closeOnHc(
      deps as unknown as CliDeps,
      terminals,
      asRegistry(registry),
      {
        ...RECORD,
        name: "child-reader",
        paneId: "t3",
        terminal: "t3",
      },
    );

    expect(result).toStrictEqual({
      error:
        "Session child-reader runs on terminal t3, whose parent is t2, not t1; only the terminal that spawned it may close it, so nothing was closed.",
    });
    expect(kill).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe("closeOnHc refuses what the caller may not do, and closes nothing", () => {
  it("refuses a terminal with no parent at all", async () => {
    const terminals = await world("t1");

    const result = await closeOnHc(
      deps as unknown as CliDeps,
      terminals,
      asRegistry(registry),
      {
        ...RECORD,
        name: "other-shell",
        paneId: "t4",
        terminal: "t4",
      },
    );

    expect(result).toStrictEqual({
      error:
        "Session other-shell runs on terminal t4, whose parent is none, not t1; only the terminal that spawned it may close it, so nothing was closed.",
    });
    expect(await terminals.get("t4")).toMatchObject({ state: "live" });
  });

  it("refuses when the caller is not inside an hc terminal", async () => {
    const terminals = await world(undefined);

    const result = await closeOnHc(
      deps as unknown as CliDeps,
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(result).toStrictEqual({
      error:
        "Not inside an hc terminal (HC_TERMINAL_ID is unset), so session close image-trust-writer was not run. Run it from the terminal that spawned the session.",
    });
    expect(recorded).not.toHaveBeenCalled();
  });

  it("refuses a record that is already closed", async () => {
    const terminals = await world("t1");

    const result = await closeOnHc(
      deps as unknown as CliDeps,
      terminals,
      asRegistry(registry),
      {
        ...RECORD,
        closedAt: CLOSED_AT,
      },
    );

    expect(result).toStrictEqual({
      error: "Session image-trust-writer is already closed (terminal t2).",
    });
    expect(await terminals.get("t2")).toMatchObject({ state: "live" });
  });
});

describe("closeOnHc keeps a terminal whose ledger event it could not write", () => {
  it("does not remove the terminal, and leaves the record open, so a rerun can finish the close", async () => {
    const terminals = await world("t1");
    const remove = vi.spyOn(terminals, "remove");
    recorded.mockResolvedValue(
      "cannot find the main checkout to keep the ledger in",
    );

    const result = await closeOnHc(
      deps as unknown as CliDeps,
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(result).toStrictEqual({
      error:
        "Session image-trust-writer was killed, but its ledger event was not recorded (cannot find the main checkout to keep the ledger in), so terminal t2 was not removed. Run session close image-trust-writer again.",
    });
    expect(remove).not.toHaveBeenCalled();
    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe("closeHcSession prints the close, or the reason it was refused", () => {
  it("prints the terminal it closed and exits 0", async () => {
    const terminals = await world("t1");

    const code = await closeHcSession(
      contextOf(deps),
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(code).toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Closed image-trust-writer (terminal t2).\n",
    );
  });

  it("prints the close as JSON with --json", async () => {
    const terminals = await world("t1");

    await closeHcSession(
      contextOf(deps, { json: true }),
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"name":"image-trust-writer","terminal":"t2","closed":true}\n',
    );
  });

  it("refuses --remove-worktree before anything is killed, since hc does not remove worktrees yet", async () => {
    const terminals = await world("t1");
    const kill = vi.spyOn(terminals, "kill");

    const code = await closeHcSession(
      contextOf(deps, { options: { "remove-worktree": true } }),
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      FAILED,
      "session close image-trust-writer --remove-worktree is not on hc yet, so nothing was closed. Close it without the flag, then remove its worktree with git once its pull request is merged.",
    );
    expect(kill).not.toHaveBeenCalled();
  });

  it("fails through fail with the refusal from closeOnHc, and exits 1", async () => {
    const terminals = await world(undefined);

    const code = await closeHcSession(
      contextOf(deps),
      terminals,
      asRegistry(registry),
      RECORD,
    );

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      FAILED,
      "Not inside an hc terminal (HC_TERMINAL_ID is unset), so session close image-trust-writer was not run. Run it from the terminal that spawned the session.",
    );
  });
});
