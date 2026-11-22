import type { Command } from "../runtime/index.js";
import { approveCommand } from "./approve-commands.js";
import { evaluateCommand } from "./evaluate-commands.js";
import { flowCommands } from "./flow-commands.js";
import { ledgerCommands } from "./ledger-commands.js";
import { orchestrateCommands } from "./orchestrate-commands.js";
import { queueDomain } from "./queue-help.js";
import { retroCommands } from "./retro-commands.js";

/** The domains that read or write the stage ledger (retro writes only its own retro-triggered events, approve only its auto-approved ones). */
export const measurement: Record<string, Record<string, Command>> = {
  ledger: ledgerCommands,
  flow: flowCommands,
  queue: queueDomain,
  retro: retroCommands,
  // `harness evaluate`: the one command of its domain, so it takes no command word.
  evaluate: { "": evaluateCommand },
  orchestrate: orchestrateCommands,
  // `harness approve`: the one command of its domain, so it takes no command word.
  approve: { "": approveCommand },
};
