import { describe, expect, it, vi } from "vitest";
import { orchestrateCommands } from "./orchestrate-commands.js";
import { planCommand } from "./orchestrate-plan.js";
import { tickCommand } from "./orchestrate-tick.js";
import { tickHelp } from "./orchestrate-tick-help.js";

vi.mock("./orchestrate-plan.js", () => ({
  planCommand: { summary: "plan" },
}));
vi.mock("./orchestrate-tick.js", () => ({
  tickCommand: { summary: "tick" },
}));

describe("the orchestrate commands", () => {
  it("registers the tick command with its help, since one idea runs through orchestrate tick --idea --loop", () => {
    expect(orchestrateCommands["tick"]).toEqual({
      ...tickCommand,
      help: tickHelp,
    });
  });

  it("registers the plan command beside tick, so the tick's judgment flow can persist a work plan", () => {
    expect(orchestrateCommands["plan"]).toBe(planCommand);
  });

  it("has no run command, which orchestrate tick --idea <n> --loop replaced", () => {
    expect(Object.keys(orchestrateCommands)).toEqual(["tick", "plan"]);
  });
});
