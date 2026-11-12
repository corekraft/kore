import { ideaCommands } from "../idea/index.js";
import type { Command } from "../runtime/index.js";
import { challenge } from "./challenge-commands.js";
import { flagCommands } from "./flag-commands.js";
import { statusCommand } from "./status-command.js";
import { outcomeCommands } from "./outcome-commands.js";

/** The delivery loop's records: ideas, the outcomes that close them, and the flags those outcomes prove. */
export const records: Record<string, Record<string, Command>> = {
  idea: { ...ideaCommands, challenge },
  outcome: outcomeCommands,
  flag: flagCommands,
  // `harness status`: the one command of its domain, so it takes no command word.
  status: { "": statusCommand },
};
