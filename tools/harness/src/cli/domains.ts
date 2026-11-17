import { adrCommands } from "../adr/index.js";
import { guardrailCliCommands } from "./guardrail-commands.js";
import { measurement } from "./measurement.js";
import { records } from "./records.js";
import {
  planActive,
  planClearNext,
  planNext,
  planTick,
} from "../plan/index.js";
import { hostDomains } from "./host.js";
import { harnessCommands } from "./harness-commands.js";
import type { Command } from "../runtime/index.js";

/** Domains arrive here as they are built; each is a map of command name to command. */
export const domains: Record<string, Record<string, Command>> = {
  harness: harnessCommands,
  plan: {
    active: planActive,
    tick: planTick,
    next: planNext,
    "clear-next": planClearNext,
  },
  adr: adrCommands,
  guardrail: guardrailCliCommands,
  ...hostDomains,
  ...records,
  ...measurement,
};
