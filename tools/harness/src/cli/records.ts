import { ideaCommands } from "../idea/index.js";
import type { Command } from "../runtime/index.js";
import { flagCommands } from "./flag-commands.js";
import { outcomeCommands } from "./outcome-commands.js";

/** The delivery loop's records: ideas, the outcomes that close them, and the flags those outcomes prove. */
export const records: Record<string, Record<string, Command>> = {
  idea: ideaCommands,
  outcome: outcomeCommands,
  flag: flagCommands,
};
