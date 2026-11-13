import type { Command } from "../runtime/index.js";
import { flowCommands } from "./flow-commands.js";
import { ledgerCommands } from "./ledger-commands.js";
import { queueCommands } from "./queue-commands.js";

/** The domains that read or write the stage ledger. */
export const measurement: Record<string, Record<string, Command>> = {
  ledger: ledgerCommands,
  flow: flowCommands,
  queue: queueCommands,
};
