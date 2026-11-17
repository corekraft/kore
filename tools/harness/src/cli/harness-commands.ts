import pkg from "../../package.json" with { type: "json" };
import type { Command } from "../runtime/index.js";
import { harnessWait } from "./wait-command.js";

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

/** The `harness` domain: its version, and the one background wait over pull requests and panes (ADR 0123). */
export const harnessCommands: Record<string, Command> = {
  version,
  wait: harnessWait,
};
