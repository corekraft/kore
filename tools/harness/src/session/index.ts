import type { Command } from "../runtime/index.js";
import { close } from "./close.js";
import { equalize } from "./equalize.js";
import { notify } from "./notify.js";
import { spawn } from "./spawn.js";
import { tier } from "./tier.js";
import { wait } from "./wait.js";

const spawnCommand: Command = {
  summary:
    "start a Claude session in a Herdr pane (--role --name --brief [--model --effort, default from .claude/agents/<role>.md] --idea N|#N stamps the idea into the pane's environment for the ledger; --timeout ms; --worktree [--branch b] runs it in a new git worktree under .claude/worktrees); with the role-tokens flag on in the local environment overlay (off by default, and spawn is unchanged while it is), a writer pane gets a minted kore-writer installation token and a judge pane the judge PAT as GH_TOKEN through a FIFO, never argv or disk (a missing identity fails with a hint naming tools/harness/wizards/identities.sh); it waits for the result unless --no-wait, the normal pattern: spawn with --no-wait, then run `session wait <name>` in the background",
  options: {
    role: "string",
    model: "string",
    effort: "string",
    name: "string",
    brief: "string",
    "no-wait": "boolean",
    worktree: "boolean",
    branch: "string",
    idea: "string",
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

const notifyCommand: Command = {
  summary:
    "tell the caller pane this session finished: sends `[herdr:<name>] finished: RESULT <outcome>; summary in pane <this pane>` to <pane> and submits it, then confirms it shows there (<pane> --outcome done|blocked; a spawned session runs it as its last action, from the brief)",
  operand: "pane",
  options: { outcome: "string" },
  run: notify,
};

const closeCommand: Command = {
  summary:
    "close a spawned pane once its result is recorded (<name>; only the pane that spawned it)",
  operand: "name",
  run: close,
};

const tierCommand: Command = {
  summary:
    "print the model and effort a role launches at, from .claude/agents/<role>.md (<role>; read-only)",
  operand: "role",
  run: tier,
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
  notify: notifyCommand,
  close: closeCommand,
  tier: tierCommand,
  equalize: equalizeCommand,
};
