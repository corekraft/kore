import { ideaCommands } from "../idea/index.js";
import type { Command } from "../runtime/index.js";
import { rulesetCommands } from "../ruleset/index.js";
import { challenge } from "./challenge-commands.js";
import { flagCommands } from "./flag-commands.js";
import { statusCommand } from "./status-command.js";
import { judgeCommands } from "./judge-commands.js";
import { outcomeCommands } from "./outcome-commands.js";

/** The delivery loop's records: ideas, the outcomes that close them, the flags those outcomes prove, and the judge's precheck. */
export const records: Record<string, Record<string, Command>> = {
  idea: { ...ideaCommands, challenge },
  outcome: outcomeCommands,
  flag: flagCommands,
  ruleset: rulesetCommands,
  // `harness status`: the one command of its domain, so it takes no command word.
  status: { "": statusCommand },
  judge: judgeCommands,
};
