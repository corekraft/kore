import { ideaCommands } from "../idea/index.js";
import type { Command } from "../runtime/index.js";
import { outcomeCommands } from "./outcome-commands.js";

/** The delivery loop's records: ideas, and the outcomes that close them. */
export const records: Record<string, Record<string, Command>> = {
  idea: ideaCommands,
  outcome: outcomeCommands,
};
