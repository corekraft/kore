import type { Command } from "../runtime/index.js";
import { flagCommands } from "./flag-commands.js";
import { platformCommands } from "./platform-commands.js";

/** The records of what reaches an environment: the flags turned on, and the platform rollouts recorded. */
export const releaseRecords = {
  flag: flagCommands,
  platform: platformCommands,
} satisfies Record<string, Record<string, Command>>;
