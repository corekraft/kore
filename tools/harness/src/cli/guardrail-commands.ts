// The guardrail domain's command table: the ledger-backed commands and the read-only replay of a
// guard change over the transcripts (which never reads the ledger). The domain table takes this.
import type { Command } from "../runtime/index.js";
import { guardrailReplay } from "./guardrail-replay-commands.js";
import { guardrailLedgerCommands } from "./guardrail-request-commands.js";

export const guardrailCliCommands: Record<string, Command> = {
  ...guardrailLedgerCommands,
  replay: guardrailReplay,
};
