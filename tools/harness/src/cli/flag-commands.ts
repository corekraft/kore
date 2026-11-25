// The flag command table: `flag activate`, `flag audit`, `flag progress` and `flag retire`.
// Each command lives in its own module; this file only names them.

import type { Command } from "../runtime/index.js";
import { activate } from "./flag-activate-command.js";
import { audit } from "./flag-audit-command.js";
import { progress } from "./flag-progress-command.js";
import { retire } from "./flag-retire-command.js";

export const flagCommands: Record<string, Command> = {
  activate,
  audit,
  progress,
  retire,
};
