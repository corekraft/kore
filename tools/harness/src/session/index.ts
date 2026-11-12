import type { Command } from "../runtime/index.js";
import { close } from "./close.js";
import { equalize } from "./equalize.js";
import { spawn } from "./spawn.js";
import { wait } from "./wait.js";

const spawnCommand: Command = {
  summary:
    "start a Claude session in a Herdr pane and wait for its result (--role --model --effort --name --brief --no-wait --timeout ms)",
  options: {
    role: "string",
    model: "string",
    effort: "string",
    name: "string",
    brief: "string",
    "no-wait": "boolean",
    timeout: "string",
  },
  run: spawn,
};

const waitCommand: Command = {
  summary:
    "wait for a spawned session's RESULT line and print its outcome (<name> --timeout ms)",
  operand: "name",
  options: { timeout: "string" },
  run: wait,
};

const closeCommand: Command = {
  summary:
    "close a spawned pane once its result is recorded (<name>; only the pane that spawned it)",
  operand: "name",
  run: close,
};

const equalizeCommand: Command = {
  summary: "equalize the heights of the spawned panes (run after closing one)",
  async run({ json, deps }) {
    const callerPane = deps.env.HERDR_PANE_ID;
    if (deps.env.HERDR_ENV !== "1" || !callerPane) {
      deps.stderr(
        "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from a Herdr pane.\n",
      );
      return 1;
    }
    const result = await equalize(deps.runner, callerPane);
    if (result.status === "failed") {
      deps.stderr(`${result.reason}\n`);
      return 1;
    }
    const text =
      result.status === "skipped" ? `Skipped: ${result.reason}.` : "Equalized.";
    deps.stdout(json ? `${JSON.stringify(result)}\n` : `${text}\n`);
    return 0;
  },
};

/** The `session` domain: commands that run other Claude sessions in Herdr panes. */
export const session: Record<string, Command> = {
  spawn: spawnCommand,
  wait: waitCommand,
  close: closeCommand,
  equalize: equalizeCommand,
};
