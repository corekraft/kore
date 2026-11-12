import pkg from "../../package.json" with { type: "json" };
import { adrCommands } from "../adr/index.js";
import { planActive } from "../plan/index.js";
import { session } from "../session/index.js";
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
  plan: { active: planActive },
  adr: adrCommands,
  session,
};
