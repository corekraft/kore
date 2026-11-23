import { planCommand } from "./orchestrate-plan.js";
import { tickCommand } from "./orchestrate-tick.js";
import { tickHelp } from "./orchestrate-tick-help.js";
import type { Command } from "../runtime/index.js";

export const orchestrateCommands: Record<string, Command> = {
  tick: { ...tickCommand, help: tickHelp },
  plan: planCommand,
};
