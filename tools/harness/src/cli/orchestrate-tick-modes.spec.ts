import { beforeEach, describe, expect, it, vi } from "vitest";
import { leasedPass } from "../orchestrator/index.js";
import type { CommandContext } from "../runtime/index.js";
import { runOnTicks, tickCommand } from "./orchestrate-tick.js";
import { hasOutcomeFlags, runIdea } from "./orchestrate-tick-idea.js";
import { installTickJob } from "./orchestrate-tick-install.js";
import { runTickLoop } from "./orchestrate-tick-loop.js";

vi.mock("./orchestrate-tick-install.js", () => ({ installTickJob: vi.fn() }));
vi.mock("./orchestrate-tick-loop.js", () => ({ runTickLoop: vi.fn() }));
vi.mock("./orchestrate-tick-idea.js", () => ({
  hasOutcomeFlags: vi.fn(),
  runIdea: vi.fn(),
}));
vi.mock("../orchestrator/index.js", () => ({
  HarnessCliError: class extends Error {},
  leasedPass: vi.fn(),
}));
vi.mock("../runtime/index.js", () => ({}));
vi.mock("../session/index.js", () => ({}));
vi.mock("../ledger/index.js", () => ({}));

function setup(options: Record<string, string | boolean> = {}) {
  const err: string[] = [];
  const context = {
    json: false,
    options,
    deps: {
      root: () => Promise.resolve("/repo"),
      stdout: vi.fn(),
      stderr: (t: string) => err.push(t),
    } as unknown as CommandContext["deps"],
  } as CommandContext;
  return { context, err };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("orchestrate tick, which mode its flags pick", () => {
  it("hands --loop alone to the background loop, and runs no single pass", async () => {
    vi.mocked(runTickLoop).mockResolvedValue(0);
    const { context } = setup({ loop: true });

    expect(await tickCommand.run(context)).toBe(0);
    expect(runTickLoop).toHaveBeenCalledWith(context.deps, "/repo");
    expect(runIdea).not.toHaveBeenCalled();
    expect(leasedPass).not.toHaveBeenCalled();
  });

  it("hands --idea with --loop to the one-idea run, not the background loop", async () => {
    vi.mocked(runIdea).mockResolvedValue(1);
    const { context } = setup({ loop: true, idea: "7", kind: "experiment" });
    vi.mocked(hasOutcomeFlags).mockReturnValue(true);

    expect(await tickCommand.run(context)).toBe(1);
    expect(runIdea).toHaveBeenCalledWith(context, "/repo", "7", runOnTicks);
    expect(runTickLoop).not.toHaveBeenCalled();
    expect(leasedPass).not.toHaveBeenCalled();
  });

  it.each([
    ["--idea without --loop", { idea: "7", kind: "experiment" }],
    ["--loop without --idea", { loop: true, kind: "experiment" }],
    ["--install", { install: true, idea: "7", kind: "experiment" }],
  ])("refuses the outcome flags given with %s", async (_name, options) => {
    vi.mocked(hasOutcomeFlags).mockReturnValue(true);
    const { context, err } = setup(options);

    expect(await tickCommand.run(context)).toBe(1);
    expect(err.join("")).toContain("`orchestrate tick --idea <number> --loop`");
    expect(runIdea).not.toHaveBeenCalled();
    expect(runTickLoop).not.toHaveBeenCalled();
    expect(installTickJob).not.toHaveBeenCalled();
    expect(leasedPass).not.toHaveBeenCalled();
  });

  it("hands --install to the installer and runs no pass", async () => {
    vi.mocked(installTickJob).mockResolvedValue(1);
    const { context } = setup({ install: true });

    expect(await tickCommand.run(context)).toBe(1);
    expect(installTickJob).toHaveBeenCalledWith(context.deps, "/repo");
    expect(leasedPass).not.toHaveBeenCalled();
  });
});
