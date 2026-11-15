import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessCli,
  IdeaRun,
  HarnessCliError,
  RetroLaunch,
  retroFlagOn,
  type RetroPorts,
} from "../orchestrator/index.js";
import type { CommandContext } from "../runtime/index.js";
import { orchestrateCommands } from "./orchestrate-commands.js";

vi.mock("../orchestrator/index.js", () => ({
  HarnessCli: vi.fn(),
  IdeaRun: vi.fn(),
  RetroLaunch: vi.fn(),
  RETRO_MODEL: "claude-opus-5-5",
  retroFlagOn: vi.fn(),
  HarnessCliError: class extends Error {},
}));

const run = vi.fn();
const ROOT = "root-dir";
const OUTCOME = {
  kind: "verification",
  source: "comparison",
  result: "confirmed",
  evidence: "PR #50",
  summary: "Merged.",
};

function setup(options: Record<string, string | boolean>, json = false) {
  const out: string[] = [];
  const err: string[] = [];
  const context: CommandContext = {
    json,
    options,
    deps: {
      runner: { run: vi.fn() },
      fs: { fs: true },
      root: () => Promise.resolve(ROOT),
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
    } as unknown as CommandContext["deps"],
  };
  return { context, out, err };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(IdeaRun).mockImplementation(function () {
    return { run } as unknown as IdeaRun;
  });
  run.mockResolvedValue({ status: "outcome-recorded", rounds: 2 });
});

describe("orchestrate run", () => {
  it("runs the idea with the given outcome through the harness tools and says how it ended", async () => {
    const { context, out } = setup({ idea: "0042", ...OUTCOME });
    expect(await orchestrateCommands["run"]?.run(context)).toBe(0);
    expect(HarnessCli).toHaveBeenCalledWith(context.deps.runner, ROOT);
    expect(run).toHaveBeenCalledWith("0042", OUTCOME);
    expect(out.join("")).toBe("Idea 0042: outcome-recorded after 2 rounds.\n");
  });

  it("passes no outcome when none is given, so the idea is never closed", async () => {
    const { context } = setup({ idea: "0042" });
    await orchestrateCommands["run"]?.run(context);
    expect(run).toHaveBeenCalledWith("0042", undefined);
  });

  it("refuses a partial outcome before running anything", async () => {
    const { context, err } = setup({ idea: "0042", kind: "verification" });
    expect(await orchestrateCommands["run"]?.run(context)).toBe(1);
    expect(err.join("")).toBe(
      "Incomplete outcome: also pass --source, --result, --evidence, --summary, or none of them to stop after the merge.\n",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("requires the idea", async () => {
    const { context, err } = setup({});
    expect(await orchestrateCommands["run"]?.run(context)).toBe(1);
    expect(err.join("")).toBe(
      "Missing --idea; run `harness orchestrate run --idea <number>`, with the idea number from `harness queue next`.\n",
    );
  });

  it("exits non-zero when the run stops short of an outcome", async () => {
    run.mockResolvedValue({ status: "blocked", rounds: 1 });
    const { context, out } = setup({ idea: "0042", ...OUTCOME }, true);
    expect(await orchestrateCommands["run"]?.run(context)).toBe(1);
    expect(out.join("")).toBe('{"status":"blocked","rounds":1}\n');
  });

  it("reports a failing harness tool as an actionable error", async () => {
    run.mockRejectedValue(new HarnessCliError("`harness x` failed: no."));
    const { context, err } = setup({ idea: "0042", ...OUTCOME });
    expect(await orchestrateCommands["run"]?.run(context)).toBe(1);
    expect(err.join("")).toBe("`harness x` failed: no.\n");
  });
});

describe("orchestrate run between pieces of work", () => {
  const retroRun = vi.fn();
  const harness = {
    retroDue: vi.fn(),
    retroRecord: vi.fn(),
    spawnRetro: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(HarnessCli).mockImplementation(function () {
      return harness as unknown as HarnessCli;
    });
    vi.mocked(RetroLaunch).mockImplementation(function () {
      return { run: retroRun } as unknown as RetroLaunch;
    });
    retroRun.mockResolvedValue({ status: "not-due" });
  });

  async function hookOf(options: Record<string, string | boolean>) {
    const made = setup(options);
    await orchestrateCommands["run"]?.run(made.context);
    const hook = vi.mocked(IdeaRun).mock.calls[0]?.[1];
    return { ...made, hook };
  }

  it("hands IdeaRun a between-work hook that checks for a retro, and nothing runs it inside the command", async () => {
    const { hook } = await hookOf({ idea: "0042" });

    expect(hook).toBeTypeOf("function");
    expect(retroRun).not.toHaveBeenCalled();
    await hook?.();
    expect(retroRun).toHaveBeenCalledTimes(1);
  });

  it("builds the launch ports from the harness tools and the local overlay flag", async () => {
    const { hook, context } = await hookOf({ idea: "0042" });
    await hook?.();
    const ports = vi.mocked(RetroLaunch).mock.calls[0]?.[0] as RetroPorts;
    vi.mocked(retroFlagOn).mockResolvedValue(true);
    harness.retroDue.mockResolvedValue({ due: false });

    expect(await ports.flagOn()).toBe(true);
    expect(retroFlagOn).toHaveBeenCalledWith(context.deps.fs, ROOT);
    expect(await ports.due()).toEqual({ due: false });
  });

  it("says on stderr, not stdout, when a retro pane was started", async () => {
    retroRun.mockResolvedValue({
      status: "launched",
      reason: "count",
      name: "retro-20261115-0930",
    });
    const { hook, out, err } = await hookOf({ idea: "0042" });
    await hook?.();

    expect(out.join("")).toBe("Idea 0042: outcome-recorded after 2 rounds.\n");
    expect(err.join("")).toBe(
      "Started retro pane retro-20261115-0930 (count) on claude-opus-5-5; collect it with `session wait retro-20261115-0930`.\n",
    );
  });

  it("stays silent when no retro was started", async () => {
    const { hook, err } = await hookOf({ idea: "0042" });
    await hook?.();

    expect(err.join("")).toBe("");
  });
});

describe("orchestrate run usage text", () => {
  const summary = orchestrateCommands["run"]?.summary ?? "";

  it("says a failing precheck is sent back to the writer before any judge pane", () => {
    expect(summary).toContain(
      "runs `judge precheck` before it launches any judge pane",
    );
    expect(summary).toContain(
      "sends a failing change back to its writer with the precheck's reason through `judge send-back`",
    );
    expect(summary).toContain("launching no judge pane");
  });

  it("says a send-back counts once per PR head toward the writer's escalation", () => {
    expect(summary).toContain("counted once per PR head");
  });
});
