import pkg from "../../package.json" with { type: "json" };
import { planActive } from "../plan/index.js";
import type { Clock, FileSystem, Runner } from "../runtime/index.js";

export interface CliDeps {
  runner: Runner;
  clock: Clock;
  fs: FileSystem;
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CommandContext {
  json: boolean;
  deps: CliDeps;
}
export interface Command {
  summary: string;
  run(context: CommandContext): Promise<number>;
}

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
};
