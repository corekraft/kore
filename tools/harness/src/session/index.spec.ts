import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext, Runner } from "../runtime/index.js";
import { resolveTier } from "./agent-definition.js";
import { check } from "./check.js";
import { close } from "./close.js";
import { equalize, type EqualizeResult } from "./equalize.js";
import { resolveTier as exported, session } from "./index.js";
import { notify } from "./notify.js";
import { report } from "./report.js";
import { send } from "./send.js";
import { spawn } from "./spawn.js";
import { tier } from "./tier.js";
import { wait } from "./wait.js";

vi.mock("./agent-definition.js", () => ({ resolveTier: vi.fn() }));
vi.mock("./check.js", () => ({ check: vi.fn() }));
vi.mock("./close.js", () => ({ close: vi.fn() }));
vi.mock("./equalize.js", () => ({ equalize: vi.fn() }));
vi.mock("./notify.js", () => ({ notify: vi.fn() }));
vi.mock("./report.js", () => ({ report: vi.fn() }));
vi.mock("./send.js", () => ({ send: vi.fn() }));
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
    ["spawn", spawn],
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
});

describe("the session domain's check usage", () => {
  it("says check is read-only and names session spawn as the fix", () => {
    const summary = session.check?.summary ?? "";
    expect(summary).toContain("role-tokens");
    expect(summary).toContain("session spawn");
    expect(summary).toContain("read-only");
  });
});

describe("the session domain's spawn usage and flags", () => {
  it("says in spawn's usage that a pane is named for its subject and an undefined role is refused", () => {
    const summary = session.spawn?.summary ?? "";
    expect(summary).toContain("named after its subject");
    expect(summary).toContain(
      "a name with a letter, ordinal or step number is refused",
    );
    expect(summary).toContain("a role with an agent definition");
    expect(summary).toContain(
      "brief a verifier or fixer as a reader or a writer",
    );
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
      "no-idea": "string",
      pr: "string",
      reason: "string",
      timeout: "string",
    });
    expect(session["spawn"]?.summary).toContain("--no-wait");
  });

  it("names --no-idea and its warning in spawn's summary, so a spawn with no idea is explained", () => {
    expect(session["spawn"]?.summary).toContain(
      "--no-idea <reason> (1 to 100 characters) says why a session serves no idea, and is refused with --idea; a writer, judge or principles-review spawn with neither warns and still starts",
    );
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

describe("the session domain's spawn usage", () => {
  it("describes the owner-writer flag's writer and judge identities", () => {
    const summary = session.spawn?.summary ?? "";
    expect(summary).toContain(
      "with the owner-writer flag also on (off by default), a writer pane gets the owner's own gh login token, read with gh auth token at spawn (a failure refuses and says to run gh auth login), and a judge pane a minted kore-judge installation token instead of the judge PAT",
    );
  });

  it("names the window effort variable and the eligibility rule for a writer that names no model", () => {
    const summary = session.spawn?.summary ?? "";
    expect(summary).toContain(
      "a writer that names no --model is eligible: the window samples a share of them onto Sonnet, recorded as an override with the reason experiment, and keeps the rest on their definition's model as the control, recorded with the reason experiment-control; every eligible writer runs at the window effort whatever --effort it names; a writer that names a --model is never sampled; KORE_WRITER_EXPERIMENT_EFFORT sets the window effort, one of low, medium, high, xhigh or max, required while KORE_WRITER_EXPERIMENT_START is a UTC date and ignored while it is unset",
    );
  });

  it("tells the main session to name no --model for a writer while the window is open, since an explicit model overrides the sampling", () => {
    const summary = session.spawn?.summary ?? "";
    expect(summary).toContain(
      "while KORE_WRITER_EXPERIMENT_START is a UTC date, the main session names no --model for a writer, because an explicit --model overrides the sampling, and names no --effort or the window effort",
    );
  });
});
