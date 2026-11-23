import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessCli,
  HarnessCliError,
  IdeaRun,
  tickFlagOn,
} from "../orchestrator/index.js";
import { retroHook } from "./orchestrate-retro.js";
import { runIdea } from "./orchestrate-tick-idea.js";
import type { CommandContext } from "../runtime/index.js";

vi.mock("./orchestrate-retro.js", () => ({ retroHook: vi.fn() }));
vi.mock("../orchestrator/index.js", () => ({
  HarnessCli: vi.fn(),
  IdeaRun: vi.fn(),
  HarnessCliError: class extends Error {},
  tickFlagOn: vi.fn(),
}));

const run = vi.fn();
const onTicks = vi.fn();
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

const idea = (
  context: CommandContext,
  id = context.options["idea"] as string,
) => runIdea(context, ROOT, id, onTicks);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(IdeaRun).mockImplementation(function () {
    return { run } as unknown as IdeaRun;
  });
  run.mockResolvedValue({ status: "outcome-recorded", rounds: 2 });
});

describe("orchestrate tick --idea --loop with the orchestrator-tick flag on", () => {
  beforeEach(() => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
  });

  it("runs the idea as ticks scoped to it, with the given outcome, and says how it ended", async () => {
    onTicks.mockResolvedValue({ status: "outcome-recorded", rounds: 5 });
    const { context, out } = setup({ idea: "0042", ...OUTCOME });

    expect(await idea(context)).toBe(0);
    expect(tickFlagOn).toHaveBeenCalledWith(context.deps.fs, ROOT);
    expect(onTicks).toHaveBeenCalledWith(context.deps, ROOT, "0042", OUTCOME);
    expect(IdeaRun).not.toHaveBeenCalled();
    expect(out.join("")).toBe("Idea 0042: outcome-recorded after 5 rounds.\n");
  });

  it("passes no outcome when none is given, so the idea is never closed", async () => {
    onTicks.mockResolvedValue({ status: "awaiting-outcome", rounds: 1 });
    const { context, out } = setup({ idea: "0042" });

    expect(await idea(context)).toBe(1);
    expect(onTicks).toHaveBeenCalledWith(context.deps, ROOT, "0042", undefined);
    expect(out.join("")).toBe("Idea 0042: awaiting-outcome after 1 round.\n");
  });

  it("exits non-zero and prints the status as JSON when the run stops short of an outcome", async () => {
    onTicks.mockResolvedValue({ status: "blocked", rounds: 1 });
    const { context, out } = setup({ idea: "0042", ...OUTCOME }, true);

    expect(await idea(context)).toBe(1);
    expect(out.join("")).toBe('{"status":"blocked","rounds":1}\n');
  });
});

describe("orchestrate tick --idea --loop with the orchestrator-tick flag off", () => {
  beforeEach(() => {
    vi.mocked(tickFlagOn).mockResolvedValue(false);
  });

  it("runs the idea with the given outcome through the harness tools and says how it ended, starting no tick", async () => {
    const { context, out } = setup({ idea: "0042", ...OUTCOME });

    expect(await idea(context)).toBe(0);
    expect(HarnessCli).toHaveBeenCalledWith(context.deps.runner, ROOT);
    expect(run).toHaveBeenCalledWith("0042", OUTCOME);
    expect(onTicks).not.toHaveBeenCalled();
    expect(out.join("")).toBe("Idea 0042: outcome-recorded after 2 rounds.\n");
  });

  it("passes no outcome when none is given, so the idea is never closed", async () => {
    const { context } = setup({ idea: "0042" });
    await idea(context);
    expect(run).toHaveBeenCalledWith("0042", undefined);
  });

  it("hands IdeaRun the retro hook built from the harness tools, and nothing runs it inside the command", async () => {
    const hook = vi.fn();
    const harness = { harness: true };
    vi.mocked(HarnessCli).mockImplementation(function () {
      return harness as unknown as HarnessCli;
    });
    vi.mocked(retroHook).mockReturnValue(hook);
    const { context } = setup({ idea: "0042" });

    await idea(context);

    expect(retroHook).toHaveBeenCalledWith(context.deps, ROOT, harness);
    expect(vi.mocked(IdeaRun).mock.calls[0]?.[1]).toBe(hook);
    expect(hook).not.toHaveBeenCalled();
  });

  it("exits non-zero when the run stops short of an outcome", async () => {
    run.mockResolvedValue({ status: "gave-up", rounds: 6 });
    const { context, out } = setup({ idea: "0042", ...OUTCOME });

    expect(await idea(context)).toBe(1);
    expect(out.join("")).toBe("Idea 0042: gave-up after 6 rounds.\n");
  });
});

describe("orchestrate tick --idea --loop refusing its input", () => {
  it("refuses a partial outcome before running anything", async () => {
    const { context, err } = setup({ idea: "0042", kind: "verification" });

    expect(await idea(context)).toBe(1);
    expect(err.join("")).toBe(
      "Incomplete outcome: also pass --source, --result, --evidence, --summary, or none of them to stop after the merge.\n",
    );
    expect(run).not.toHaveBeenCalled();
    expect(onTicks).not.toHaveBeenCalled();
  });

  it("refuses an empty idea number", async () => {
    const { context, err } = setup({ idea: " " });

    expect(await idea(context, " ")).toBe(1);
    expect(err.join("")).toBe(
      "Empty --idea; pass the idea number from `harness queue next`.\n",
    );
  });

  it("reports a failing harness tool as an actionable error", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(false);
    run.mockRejectedValue(new HarnessCliError("`harness x` failed: no."));
    const { context, err } = setup({ idea: "0042", ...OUTCOME });

    expect(await idea(context)).toBe(1);
    expect(err.join("")).toBe("`harness x` failed: no.\n");
  });
});
