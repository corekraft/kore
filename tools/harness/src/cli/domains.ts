import { adrCommands } from "../adr/index.js";
import { guardrailCliCommands } from "./guardrail-commands.js";
import { measurement } from "./measurement.js";
import { records } from "./records.js";
import { planActive, planNext, planTick } from "../plan/index.js";
import { hostDomains } from "./host.js";
import { harnessCommands } from "./harness-commands.js";
import type { Command } from "../runtime/index.js";

/** Domains arrive here as they are built; each is a map of command name to command. */
export const domains = {
  harness: harnessCommands,
  plan: {
    active: planActive,
    tick: planTick,
    next: planNext,
  },
  adr: adrCommands,
  guardrail: guardrailCliCommands,
  ...hostDomains,
  ...records,
  ...measurement,
} satisfies Record<string, Record<string, Command>>;

/** The name of each domain of the table; the help guides hold one guide per name. */
export type DomainName = keyof typeof domains;
