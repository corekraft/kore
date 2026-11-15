import type { Command } from "../runtime/index.js";
import { flowCommands } from "./flow-commands.js";
import { ledgerCommands } from "./ledger-commands.js";
import { orchestrateCommands } from "./orchestrate-commands.js";
import { queueCommands } from "./queue-commands.js";
import { retroCommands } from "./retro-commands.js";

/** The domains that read or write the stage ledger (retro writes only its own retro-triggered events). */
export const measurement: Record<string, Record<string, Command>> = {
  ledger: ledgerCommands,
  flow: flowCommands,
  queue: queueCommands,
  retro: retroCommands,
  orchestrate: orchestrateCommands,
};
