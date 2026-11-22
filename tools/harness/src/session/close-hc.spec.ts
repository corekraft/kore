import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import {
  FakeTerminals,
  terminalError,
  type TerminalError,
} from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { closeOnHc } from "./close-hc.js";
import { recordTerminalEvent } from "./hc-ledger.js";
import {
  asRegistry,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import type { SessionRecord } from "./registry.js";

vi.mock("./hc-ledger.js", () => ({ recordTerminalEvent: vi.fn() }));
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
  result: { outcome: "done", at: CLOSED_AT },
};

let deps: FakeDeps;
let registry: FakeRegistry;
const recorded = vi.mocked(recordTerminalEvent);

/** Closes `record` from `terminals` through closeOnHc, with this spec's deps and registry. */
const close = (terminals: FakeTerminals, record: SessionRecord) =>
  closeOnHc(
    deps as unknown as CliDeps,
    terminals,
    asRegistry(registry),
    record,
  );

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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hcMessage).mockImplementation(
    (error: TerminalError) => error.error.message,
  );
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

    const result = await close(terminals, RECORD);

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
    expect(registry.write).toHaveBeenLastCalledWith({
      ...RECORD,
      closeEventAt: CLOSED_AT,
      closedAt: CLOSED_AT,
    });
    expect(await terminals.get("t2")).toMatchObject({
      error: { kind: "not-found" },
    });
  });

  it("does not kill a child that already finished, but still records and removes it", async () => {
    const terminals = await world("t1");
    terminals.finish("t2", 0);
    const kill = vi.spyOn(terminals, "kill");

    const result = await close(terminals, RECORD);

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

    const result = await close(terminals, {
      ...RECORD,
      name: "child-reader",
      paneId: "t3",
      terminal: "t3",
    });

    expect(result).toStrictEqual({
      error:
        "Session child-reader runs on terminal t3, whose parent is t2, not t1; only the terminal that spawned it may close it, so nothing was closed.",
    });
    expect(kill).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
    expect(registry.write).not.toHaveBeenCalled();
  });

  it("refuses a terminal with no parent at all", async () => {
    const terminals = await world("t1");

    const result = await close(terminals, {
      ...RECORD,
      name: "other-shell",
      paneId: "t4",
      terminal: "t4",
    });

    expect(result).toStrictEqual({
      error:
        "Session other-shell runs on terminal t4, whose parent is none, not t1; only the terminal that spawned it may close it, so nothing was closed.",
    });
    expect(await terminals.get("t4")).toMatchObject({ state: "live" });
  });

  it("refuses when the caller is not inside an hc terminal", async () => {
    const terminals = await world(undefined);

    const result = await close(terminals, RECORD);

    expect(result).toStrictEqual({
      error:
        "Not inside an hc terminal (HC_TERMINAL_ID is unset), so session close image-trust-writer was not run. Run it from the terminal that spawned the session.",
    });
    expect(recorded).not.toHaveBeenCalled();
  });

  it("refuses a record that is already closed", async () => {
    const terminals = await world("t1");

    const result = await close(terminals, { ...RECORD, closedAt: CLOSED_AT });

    expect(result).toStrictEqual({
      error: "Session image-trust-writer is already closed (terminal t2).",
    });
    expect(await terminals.get("t2")).toMatchObject({ state: "live" });
  });

  it("does not remove the terminal, and leaves the record open, when its ledger event cannot be written", async () => {
    const terminals = await world("t1");
    const remove = vi.spyOn(terminals, "remove");
    recorded.mockResolvedValue(
      "cannot find the main checkout to keep the ledger in",
    );

    const result = await close(terminals, RECORD);

    expect(result).toStrictEqual({
      error:
        "Session image-trust-writer was killed, but its ledger event was not recorded (cannot find the main checkout to keep the ledger in), so terminal t2 was not removed. Run session close image-trust-writer again.",
    });
    expect(remove).not.toHaveBeenCalled();
    expect(registry.write).not.toHaveBeenCalled();
  });
});

describe("closeOnHc refuses a session with no recorded result or report, and kills nothing", () => {
  it("refuses a session with neither a result nor a consumed report, with herdr's hint", async () => {
    const terminals = await world("t1");
    const kill = vi.spyOn(terminals, "kill");
    const remove = vi.spyOn(terminals, "remove");
    const { result: _result, ...unrecorded } = RECORD;

    const result = await close(terminals, unrecorded);

    expect(result).toStrictEqual({
      error:
        "Session image-trust-writer has no recorded result, so terminal t2 stays open. Run `session wait image-trust-writer` first.",
    });
    expect(kill).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
    expect(registry.write).not.toHaveBeenCalled();
  });

  it("accepts a session whose report the wait has consumed", async () => {
    const terminals = await world("t1");
    const { result: _result, ...unrecorded } = RECORD;

    const result = await close(terminals, { ...unrecorded, reportSeq: 1 });

    expect(result).toStrictEqual({ closedAt: CLOSED_AT });
  });
});

describe("closeOnHc finishes a close an earlier run began, and never repeats its event", () => {
  it("marks the record closed, killing and writing nothing, when hc no longer has the terminal", async () => {
    const terminals = await world("t1");
    await terminals.kill("t2");
    await terminals.remove("t2");
    const kill = vi.spyOn(terminals, "kill");

    const result = await close(terminals, RECORD);

    expect(result).toStrictEqual({ closedAt: CLOSED_AT });
    expect(kill).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      ...RECORD,
      closedAt: CLOSED_AT,
    });
  });

  it("removes the terminal without writing the pane.closed event again when an earlier run wrote it", async () => {
    const terminals = await world("t1");
    const remove = vi.spyOn(terminals, "remove");

    const result = await close(terminals, {
      ...RECORD,
      closeEventAt: CLOSED_AT,
    });

    expect(result).toStrictEqual({ closedAt: CLOSED_AT });
    expect(recorded).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledExactlyOnceWith("t2");
  });

  it("keeps the event's time when the removal fails, so a rerun does not write the event twice", async () => {
    const terminals = await world("t1");
    vi.spyOn(terminals, "remove").mockResolvedValue(
      terminalError("unavailable", "hc did not remove"),
    );

    const result = await close(terminals, RECORD);

    expect(result).toStrictEqual({
      error:
        "Session image-trust-writer was killed and recorded, but terminal t2 was not removed: hc did not remove.",
    });
    expect(recorded).toHaveBeenCalledExactlyOnceWith(deps, {
      kind: "pane.closed",
      pane: "t2",
      agent: "image-trust-writer",
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      ...RECORD,
      closeEventAt: CLOSED_AT,
    });
  });
});
