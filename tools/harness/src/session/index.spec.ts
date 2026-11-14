import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext, Runner } from "../runtime/index.js";
import { close } from "./close.js";
import { equalize, type EqualizeResult } from "./equalize.js";
import { session } from "./index.js";
import { notify } from "./notify.js";
import { spawn } from "./spawn.js";
import { tier } from "./tier.js";
import { wait } from "./wait.js";

vi.mock("./close.js", () => ({ close: vi.fn() }));
vi.mock("./equalize.js", () => ({ equalize: vi.fn() }));
vi.mock("./notify.js", () => ({ notify: vi.fn() }));
vi.mock("./spawn.js", () => ({ spawn: vi.fn() }));
vi.mock("./tier.js", () => ({ tier: vi.fn() }));
vi.mock("./wait.js", () => ({ wait: vi.fn() }));

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
  it("exposes spawn, wait, notify, close, tier and equalize, and no other command", () => {
    expect(Object.keys(session).sort()).toEqual([
      "close",
      "equalize",
      "notify",
      "spawn",
      "tier",
      "wait",
    ]);
  });

  it.each([
    ["spawn", spawn],
    ["wait", wait],
    ["notify", notify],
    ["close", close],
    ["tier", tier],
  ] as const)("runs %s through its own module", async (name, module) => {
    const context = {} as CommandContext;
    vi.mocked(module).mockResolvedValue(7);
    expect(await session[name]?.run(context)).toBe(7);
    expect(module).toHaveBeenCalledWith(context);
  });

  it("declares spawn's flags, and its --no-wait pattern in its summary", () => {
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
      timeout: "string",
    });
    expect(session["spawn"]?.summary).toContain("--no-wait");
  });

  it.each([
    ["wait", "name", { timeout: "string" }],
    ["notify", "pane", { outcome: "string" }],
    ["close", "name", { "remove-worktree": "boolean" }],
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
