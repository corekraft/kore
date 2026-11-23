import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { resolveTier } from "./agent-definition.js";
import { check, checkHelp } from "./check.js";
import { close, closeHelp } from "./close.js";
import { resolveTier as exported, session } from "./index.js";
import { report, reportHelp } from "./report.js";
import { send, sendHelp } from "./send.js";
import { spawnHc } from "./spawn-hc.js";
import { spawnHelp } from "./spawn-help.js";
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
vi.mock("./report.js", () => ({
  report: vi.fn(),
  reportHelp: { purpose: "report help" },
}));
vi.mock("./send.js", () => ({
  send: vi.fn(),
  sendHelp: { purpose: "send help" },
}));
vi.mock("./spawn-hc.js", () => ({ spawnHc: vi.fn() }));
vi.mock("./spawn-help.js", () => ({ spawnHelp: { purpose: "spawn help" } }));
vi.mock("./tier.js", () => ({
  tier: vi.fn(),
  tierHelp: { purpose: "tier help" },
}));
vi.mock("./wait.js", () => ({
  wait: vi.fn(),
  waitHelp: { purpose: "wait help" },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the session domain's command set", () => {
  it("exposes spawn, wait, report, send, check, close, tier and exec, and no other command", () => {
    expect(Object.keys(session).sort()).toEqual([
      "check",
      "close",
      "exec",
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
    ["spawn", spawnHc],
    ["wait", wait],
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
    ["report", reportHelp],
    ["send", sendHelp],
    ["check", checkHelp],
    ["close", closeHelp],
    ["tier", tierHelp],
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
    ["send", "name", { message: "string" }],
    [
      "close",
      "name",
      { "remove-worktree": "boolean", "force-record": "boolean" },
    ],
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
