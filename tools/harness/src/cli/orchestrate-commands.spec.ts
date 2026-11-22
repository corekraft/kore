import { tickHelp } from "./orchestrate-tick-help.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessCli,
  IdeaRun,
  HarnessCliError,
  tickFlagOn,
} from "../orchestrator/index.js";
import { briefBackend } from "../session/index.js";
import { retroHook } from "./orchestrate-retro.js";
import { runOnTicks, tickCommand } from "./orchestrate-tick.js";
import { planCommand } from "./orchestrate-plan.js";
import type { CommandContext } from "../runtime/index.js";
import { orchestrateCommands } from "./orchestrate-commands.js";

vi.mock("./orchestrate-retro.js", () => ({ retroHook: vi.fn() }));
vi.mock("../session/index.js", () => ({ briefBackend: vi.fn() }));
vi.mock("./orchestrate-plan.js", () => ({
  planCommand: { summary: "plan" },
}));
vi.mock("./orchestrate-tick.js", () => ({
  runOnTicks: vi.fn(),
  tickCommand: { summary: "tick" },
}));
vi.mock("../orchestrator/index.js", () => ({
  HarnessCli: vi.fn(),
  IdeaRun: vi.fn(),
  HarnessCliError: class extends Error {},
  tickFlagOn: vi.fn(),
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
  vi.mocked(briefBackend).mockResolvedValue("herdr");
  vi.mocked(IdeaRun).mockImplementation(function () {
    return { run } as unknown as IdeaRun;
  });
  run.mockResolvedValue({ status: "outcome-recorded", rounds: 2 });
});

describe("orchestrate run", () => {
  it("runs the idea with the given outcome through the harness tools and says how it ended", async () => {
    const { context, out } = setup({ idea: "0042", ...OUTCOME });
    expect(await orchestrateCommands["run"]?.run(context)).toBe(0);
    expect(HarnessCli).toHaveBeenCalledWith(context.deps.runner, ROOT, "herdr");
    expect(run).toHaveBeenCalledWith("0042", OUTCOME);
    expect(out.join("")).toBe("Idea 0042: outcome-recorded after 2 rounds.\n");
  });

  it("gives the run's harness the brief backend the hc-sessions flag names", async () => {
    vi.mocked(briefBackend).mockResolvedValue("hc");
    const { context } = setup({ idea: "0042" });

    await orchestrateCommands["run"]?.run(context);

    expect(HarnessCli).toHaveBeenCalledWith(context.deps.runner, ROOT, "hc");
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

describe("orchestrate run with the orchestrator-tick flag", () => {
  it("runs the idea as ticks scoped to it, not through IdeaRun, when the flag is on", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    vi.mocked(runOnTicks).mockResolvedValue({
      status: "outcome-recorded",
      rounds: 5,
    });
    const { context, out } = setup({ idea: "0042", ...OUTCOME });

    expect(await orchestrateCommands["run"]?.run(context)).toBe(0);
    expect(tickFlagOn).toHaveBeenCalledWith(context.deps.fs, ROOT);
    expect(runOnTicks).toHaveBeenCalledWith(
      context.deps,
      ROOT,
      "0042",
      OUTCOME,
    );
    expect(IdeaRun).not.toHaveBeenCalled();
    expect(out.join("")).toBe("Idea 0042: outcome-recorded after 5 rounds.\n");
  });

  it("runs through IdeaRun, and starts no tick, when the flag is off", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(false);
    const { context } = setup({ idea: "0042" });

    await orchestrateCommands["run"]?.run(context);

    expect(run).toHaveBeenCalledWith("0042", undefined);
    expect(runOnTicks).not.toHaveBeenCalled();
  });

  it("registers the tick command beside run", () => {
    expect(orchestrateCommands["tick"]).toEqual({
      ...tickCommand,
      help: tickHelp,
    });
  });

  it("registers the plan command beside tick, so the tick's judgment flow can persist a work plan", () => {
    expect(orchestrateCommands["plan"]).toBe(planCommand);
  });
});

describe("orchestrate run between pieces of work", () => {
  it("hands IdeaRun the retro hook built from the harness tools, and nothing runs it inside the command", async () => {
    const hook = vi.fn();
    const harness = { harness: true };
    vi.mocked(HarnessCli).mockImplementation(function () {
      return harness as unknown as HarnessCli;
    });
    vi.mocked(retroHook).mockReturnValue(hook);
    const { context } = setup({ idea: "0042" });

    await orchestrateCommands["run"]?.run(context);

    expect(retroHook).toHaveBeenCalledWith(context.deps, ROOT, harness);
    expect(vi.mocked(IdeaRun).mock.calls[0]?.[1]).toBe(hook);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe("orchestrate run help text", () => {
  const detail = orchestrateCommands["run"]?.help?.effects.detail ?? "";

  it("says the retro pane runs on Sonnet and its proposals are filed through a checked, capped, idempotent path", () => {
    expect(detail).toContain("starts a retro pane on Sonnet at high effort");
    expect(detail).toContain("files nothing when one item is malformed");
    expect(detail).toContain("files at most 5");
    expect(detail).toContain("trigger id plus a content hash");
    expect(detail).not.toContain("Opus");
  });

  it("says a failing precheck is sent back to the writer before any judge pane", () => {
    expect(detail).toContain(
      "runs judge precheck before it launches any judge pane",
    );
    expect(detail).toContain(
      "sends the change back to its writer through judge send-back with the precheck's reason and category",
    );
    expect(detail).toContain("launching no judge pane");
  });

  it("says a send-back counts once per PR head toward the writer's escalation", () => {
    expect(detail).toContain("counted once per PR head");
  });
});
