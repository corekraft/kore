import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext, Runner } from "../runtime/index.js";
import { resolveTier } from "./agent-definition.js";
import { check, checkHelp } from "./check.js";
import { close, closeHelp } from "./close.js";
import { equalize, equalizeHelp, type EqualizeResult } from "./equalize.js";
import { resolveTier as exported, session } from "./index.js";
import { notify, notifyHelp } from "./notify.js";
import { report, reportHelp } from "./report.js";
import { send, sendHelp } from "./send.js";
import { spawnHelp } from "./spawn.js";
import { spawnRouted } from "./spawn-route.js";
import { tier, tierHelp } from "./tier.js";
import { wait, waitHelp } from "./wait.js";

// Each command module's factory exports its handler and its help record, so the barrel
// can wire both without loading the real modules.
vi.mock("./agent-definition.js", () => ({ resolveTier: vi.fn() }));
vi.mock("./check.js", () => ({
  check: vi.fn(),
  checkHelp: { purpose: "check help" },
}));
vi.mock("./close.js", () => ({
  close: vi.fn(),
  closeHelp: { purpose: "close help" },
}));
vi.mock("./equalize.js", () => ({
  equalize: vi.fn(),
  equalizeHelp: { purpose: "equalize help" },
}));
vi.mock("./report.js", () => ({
  report: vi.fn(),
  reportHelp: { purpose: "report help" },
}));
vi.mock("./notify.js", () => ({
  notify: vi.fn(),
  notifyHelp: { purpose: "notify help" },
}));
vi.mock("./send.js", () => ({
  send: vi.fn(),
  sendHelp: { purpose: "send help" },
}));
vi.mock("./spawn-route.js", () => ({ spawnRouted: vi.fn() }));
vi.mock("./spawn.js", () => ({
  spawn: vi.fn(),
  spawnHelp: { purpose: "spawn help" },
}));
vi.mock("./tier.js", () => ({
  tier: vi.fn(),
  tierHelp: { purpose: "tier help" },
}));
vi.mock("./wait.js", () => ({
  wait: vi.fn(),
  waitHelp: { purpose: "wait help" },
}));

const HERDR = { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" };
const NOT_IN_HERDR =
  "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from a Herdr pane.\n";

/** The `equalize` command's context: captured output, a typed runner, and the given environment. */
function equalizeContext(env: Record<string, string>, json = false) {
  const out: string[] = [];
  const err: string[] = [];
  const run = vi.fn<Runner["run"]>();
  const context: CommandContext = {
    json,
    options: {},
    deps: {
      runner: { run },
      env,
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    } as unknown as CliDeps,
  };
  return { context, out, err };
}

beforeEach(() => {
  vi.mocked(equalize).mockResolvedValue({ status: "equalized" });
});

describe("the session domain's command set", () => {
  it("exposes spawn, wait, notify, report, send, check, close, tier and equalize, and no other command", () => {
    expect(Object.keys(session).sort()).toEqual([
      "check",
      "close",
      "equalize",
      "exec",
      "notify",
      "report",
      "send",
      "spawn",
      "tier",
      "wait",
    ]);
  });

  it("re-exports resolveTier as the unit's own function, not a copy", () => {
    expect(exported).toBe(resolveTier);
  });

  it.each([
    ["spawn", spawnRouted],
    ["wait", wait],
    ["notify", notify],
    ["report", report],
    ["send", send],
    ["check", check],
    ["close", close],
    ["tier", tier],
  ] as const)("runs %s through its own module", async (name, module) => {
    const context = {} as CommandContext;
    vi.mocked(module).mockResolvedValue(7);
    expect(await session[name]?.run(context)).toBe(7);
    expect(module).toHaveBeenCalledWith(context);
  });

  it.each([
    ["spawn", spawnHelp],
    ["wait", waitHelp],
    ["notify", notifyHelp],
    ["report", reportHelp],
    ["send", sendHelp],
    ["check", checkHelp],
    ["close", closeHelp],
    ["tier", tierHelp],
    ["equalize", equalizeHelp],
  ] as const)("takes %s's help record from its own module", (name, help) => {
    expect(session[name]?.help).toBe(help);
  });
});

describe("the session domain's operands and flags", () => {
  it("declares spawn's flags, which its --no-wait pattern and its idea flags rely on", () => {
    expect(session["spawn"]?.options).toEqual({
      role: "string",
      model: "string",
      effort: "string",
      name: "string",
      brief: "string",
      "no-wait": "boolean",
      worktree: "boolean",
      branch: "string",
      idea: "string",
      "no-idea": "string",
      pr: "string",
      reason: "string",
      timeout: "string",
      group: "string",
    });
  });

  it.each([
    ["wait", "name", { timeout: "string" }],
    ["notify", "pane", { outcome: "string" }],
    ["send", "name", { message: "string" }],
    ["close", "name", { "remove-worktree": "boolean" }],
    [
      "report",
      undefined,
      { outcome: "string", summary: "string", file: "string", plan: "string" },
    ],
    ["tier", "role", undefined],
  ])("takes the operand and flags %s declares", (name, operand, options) => {
    expect(session[name]?.operand).toBe(operand);
    expect(session[name]?.options).toEqual(options);
  });

  it("gives every command a one-line summary", () => {
    for (const command of Object.values(session)) {
      expect(command.summary).not.toBe("");
      expect(command.summary).not.toContain("\n");
    }
  });
});

describe("session equalize runs only inside Herdr", () => {
  it.each([
    ["HERDR_ENV is not 1", { HERDR_ENV: "0", HERDR_PANE_ID: "w3:p1" }],
    ["HERDR_PANE_ID is unset", { HERDR_ENV: "1" }],
  ])("refuses when %s, runs nothing, and exits 1", async (_what, env) => {
    const { context, err } = equalizeContext(env);
    expect(await session["equalize"]?.run(context)).toBe(1);
    expect(err.join("")).toBe(NOT_IN_HERDR);
    expect(equalize).not.toHaveBeenCalled();
  });

  it("equalizes the columns beside the caller's pane and says so", async () => {
    const { context, out } = equalizeContext(HERDR);
    expect(await session["equalize"]?.run(context)).toBe(0);
    expect(equalize).toHaveBeenCalledWith(context.deps.runner, "w3:p1");
    expect(out.join("")).toBe("Equalized.\n");
  });

  it("reports a skip with its reason and still exits 0", async () => {
    vi.mocked(equalize).mockResolvedValue({
      status: "skipped",
      reason: "no spawned column right of the caller",
    });
    const { context, out, err } = equalizeContext(HERDR);
    expect(await session["equalize"]?.run(context)).toBe(0);
    expect(out.join("")).toBe(
      "Skipped: no spawned column right of the caller.\n",
    );
    expect(err.join("")).toBe("");
  });

  it("prints the result as one JSON line with --json", async () => {
    const result: EqualizeResult = { status: "equalized" };
    const { context, out } = equalizeContext(HERDR, true);
    expect(await session["equalize"]?.run(context)).toBe(0);
    expect(out.join("")).toBe(`${JSON.stringify(result)}\n`);
  });

  it("writes herdr's failure to stderr and exits 1, printing nothing on stdout", async () => {
    vi.mocked(equalize).mockResolvedValue({
      status: "failed",
      reason: "herdr pane resize failed: too small",
    });
    const { context, out, err } = equalizeContext(HERDR);
    expect(await session["equalize"]?.run(context)).toBe(1);
    expect(err.join("")).toBe("herdr pane resize failed: too small\n");
    expect(out.join("")).toBe("");
  });
});
