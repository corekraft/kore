import pkg from "../../package.json" with { type: "json" };
import { adrCommands } from "../adr/index.js";
import { ideaCommands } from "../idea/index.js";
import { ledgerCommands } from "./ledger-commands.js";
import { planActive, planTick } from "../plan/index.js";
import { session } from "../session/index.js";
import { skill } from "../skill/index.js";
import type { Command } from "../runtime/index.js";

const version: Command = {
  summary: "print the harness version",
  run({ json, deps }) {
    deps.stdout(
      json
        ? `${JSON.stringify({ version: pkg.version })}\n`
        : `harness ${pkg.version}\n`,
    );
    return Promise.resolve(0);
  },
};

/** Domains arrive here as they are built; each is a map of command name to command. */
export const domains: Record<string, Record<string, Command>> = {
  harness: { version },
  plan: { active: planActive, tick: planTick },
  adr: adrCommands,
  session,
  skill,
  idea: ideaCommands,
  ledger: ledgerCommands,
};
