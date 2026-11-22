import { describe, expect, it, vi } from "vitest";
import type { Terminal, TerminalError } from "../terminal/index.js";
import { HarnessCliError } from "./harness-cli.js";
import type { Tick } from "./tick.js";
import {
  TickReconcile,
  reconcilingPass,
  type ReconcilePorts,
} from "./tick-reconcile.js";
import type { Unsettled } from "./tick-unsettled.js";

const MAIN = "/main";

function ports(over: Partial<ReconcilePorts> = {}): ReconcilePorts {
  return {
    unsettled: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    reported: vi.fn().mockResolvedValue(false),
    block: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

const session = (over: Partial<Unsettled> = {}): Unsettled => ({
  name: "idea-0001-writer",
  terminal: "t7",
  reportSeq: 0,
  ...over,
});

const terminal = (
  id: string,
  state: Terminal["state"],
  extra: Partial<Terminal> = {},
): Terminal => ({
  id,
  state,
  labels: {},
  cwd: "/main/.claude/worktrees/w",
  ...extra,
});

const LOST_FINISHED = "lost with its parent: terminal t7 has finished";
const LOST_GONE = "lost with its parent: terminal t7 is gone";

describe("TickReconcile.reconcile", () => {
  it("records a session whose terminal has finished as blocked, lost with its parent", async () => {
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session()]),
      list: vi.fn().mockResolvedValue([terminal("t7", "finished")]),
    });

    expect(await new TickReconcile(p, MAIN).reconcile()).toEqual([
      "idea-0001-writer",
    ]);
    expect(p.block).toHaveBeenCalledWith("idea-0001-writer", LOST_FINISHED);
  });

  it("records a session whose terminal is absent from the listing as blocked, lost with its parent", async () => {
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session()]),
      list: vi.fn().mockResolvedValue([terminal("t8", "live")]),
    });

    expect(await new TickReconcile(p, MAIN).reconcile()).toEqual([
      "idea-0001-writer",
    ]);
    expect(p.block).toHaveBeenCalledWith("idea-0001-writer", LOST_GONE);
  });

  it("leaves a live terminal alone, and a live terminal that reports error is not lost", async () => {
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session()]),
      list: vi
        .fn()
        .mockResolvedValue([terminal("t7", "live", { status: "error" })]),
    });

    expect(await new TickReconcile(p, MAIN).reconcile()).toEqual([]);
    expect(p.block).not.toHaveBeenCalled();
  });
});

describe("TickReconcile: reports and the listing", () => {
  it("leaves a finished session alone when its report is still unread, so a finished writer that reported done is not blocked", async () => {
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session()]),
      list: vi.fn().mockResolvedValue([terminal("t7", "finished")]),
      reported: vi.fn().mockResolvedValue(true),
    });

    expect(await new TickReconcile(p, MAIN).reconcile()).toEqual([]);
    expect(p.block).not.toHaveBeenCalled();
  });

  it("reads a finished terminal's report in the checkout the terminal was launched in", async () => {
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session()]),
      list: vi.fn().mockResolvedValue([terminal("t7", "finished")]),
    });

    await new TickReconcile(p, MAIN).reconcile();
    expect(p.reported).toHaveBeenCalledWith(
      session(),
      "/main/.claude/worktrees/w",
    );
  });

  it("reads an absent terminal's report in its worktree, or in the main checkout when it has none", async () => {
    const p = ports({
      unsettled: vi
        .fn()
        .mockResolvedValue([
          session({ name: "a", worktree: "/main/.claude/worktrees/a" }),
          session({ name: "b" }),
        ]),
    });

    await new TickReconcile(p, MAIN).reconcile();
    expect(p.reported).toHaveBeenCalledWith(
      session({ name: "a", worktree: "/main/.claude/worktrees/a" }),
      "/main/.claude/worktrees/a",
    );
    expect(p.reported).toHaveBeenCalledWith(session({ name: "b" }), MAIN);
  });

  it("reads the listing only when a session is unsettled", async () => {
    const p = ports();

    expect(await new TickReconcile(p, MAIN).reconcile()).toEqual([]);
    expect(p.list).not.toHaveBeenCalled();
  });

  it("refuses with hc's message and hint, and records nothing, when the listing fails", async () => {
    const failure: TerminalError = {
      error: {
        kind: "unavailable",
        message: "hc is not running",
        hint: "start the core",
      },
    };
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session()]),
      list: vi.fn().mockResolvedValue(failure),
    });

    await expect(new TickReconcile(p, MAIN).reconcile()).rejects.toThrow(
      new HarnessCliError("hc is not running (start the core)"),
    );
    expect(p.block).not.toHaveBeenCalled();
  });
});

describe("TickReconcile: settled sessions", () => {
  it("leaves a session alone once its report was consumed, even when its terminal has finished", async () => {
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session({ reportSeq: 2 })]),
      list: vi.fn().mockResolvedValue([terminal("t7", "finished")]),
    });

    expect(await new TickReconcile(p, MAIN).reconcile()).toEqual([]);
    expect(p.block).not.toHaveBeenCalled();
  });

  it("names only the sessions it recorded: one that settled meanwhile is not named", async () => {
    const p = ports({
      unsettled: vi.fn().mockResolvedValue([session()]),
      list: vi.fn().mockResolvedValue([terminal("t7", "finished")]),
      block: vi.fn().mockResolvedValue(false),
    });

    expect(await new TickReconcile(p, MAIN).reconcile()).toEqual([]);
    expect(p.block).toHaveBeenCalledTimes(1);
  });
});

describe("reconcilingPass", () => {
  it("reconciles before the pass, then returns the pass's steps for the same idea", async () => {
    const calls: string[] = [];
    const reconcile = {
      reconcile: vi.fn(() => {
        calls.push("reconcile");
        return Promise.resolve([]);
      }),
    };
    const tick = {
      pass: vi.fn((only?: string) => {
        calls.push("pass");
        return Promise.resolve([
          { idea: only ?? "", step: "waiting" as const },
        ]);
      }),
    };

    const steps = await reconcilingPass(
      reconcile,
      tick as unknown as Pick<Tick, "pass">,
    ).pass("0001");
    expect(calls).toEqual(["reconcile", "pass"]);
    expect(tick.pass).toHaveBeenCalledWith("0001");
    expect(steps).toEqual([{ idea: "0001", step: "waiting" }]);
  });

  it("runs no pass when the reconcile fails, so a lost session is never acted on blind", async () => {
    const reconcile = {
      reconcile: vi.fn().mockRejectedValue(new HarnessCliError("hc is down")),
    };
    const tick = { pass: vi.fn() };

    await expect(
      reconcilingPass(reconcile, tick as unknown as Pick<Tick, "pass">).pass(),
    ).rejects.toThrow("hc is down");
    expect(tick.pass).not.toHaveBeenCalled();
  });
});
