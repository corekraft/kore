import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessCli, IdeaRun, HarnessCliError } from "../orchestrator/index.js";
import type { CommandContext } from "../runtime/index.js";
import { orchestrateCommands } from "./orchestrate-commands.js";

vi.mock("../orchestrator/index.js", () => ({
  HarnessCli: vi.fn(),
  IdeaRun: vi.fn(),
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
