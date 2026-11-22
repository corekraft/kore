// oxlint-disable import/max-dependencies -- the session domain is one command per module, so its barrel imports each of them
import type { Command } from "../runtime/index.js";
export { handOff } from "./handoff.js";
export { FOLLOW_UP_PREFIX } from "./follow-up-prefix.js";
export { findResult, parseTimeout } from "./wait.js";
export {
  openSessionTarget,
  settleSessionTarget,
  type OpenedTarget,
  type SessionWaitTarget,
} from "./wait-target.js";
export { hostLeaseRefusal } from "./host-lease.js";
export { deliver } from "./notify.js";
export { signedMainSendsOn } from "./signed-sends.js";
export { sessionNameError } from "./names.js";
export { spawnLoadRefusal } from "./spawn-load.js";
export { PASSED_FLAGS, namesFlag } from "./exec.js";
export { SessionRegistry, type SessionRecord } from "./registry.js";
export { recordOfTerminal } from "./terminal-record.js";
import { check, checkHelp } from "./check.js";
import { close, closeHelp } from "./close.js";
import { execCommand } from "./exec.js";
import { equalize, equalizeHelp } from "./equalize.js";
import { notify, notifyHelp } from "./notify.js";
import { send, sendHelp } from "./send.js";
import { spawn, spawnHelp } from "./spawn.js";
import { tier, tierHelp } from "./tier.js";
import { wait, waitHelp } from "./wait.js";

const spawnCommand: Command = {
  summary:
    "start a Claude session in a Herdr pane, named, briefed and recorded, then wait for its RESULT line unless --no-wait",
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
    "no-idea": "string",
    pr: "string",
    reason: "string",
    timeout: "string",
  },
  help: spawnHelp,
  run: spawn,
};

const waitCommand: Command = {
  summary:
    "wait for a spawned session's RESULT line and print its outcome; --json adds result.summary, the text the pane printed before it",
  operand: "name",
  options: { timeout: "string" },
  help: waitHelp,
  run: wait,
};

const notifyCommand: Command = {
  summary:
    "tell the caller pane that this spawned session finished, with its outcome and where the summary is",
  operand: "pane",
  options: { outcome: "string" },
  help: notifyHelp,
  run: notify,
};

const sendCommand: Command = {
  summary:
    "send a one-line follow-up to a spawned session's pane, signed with its sender line and recorded as a session.send event",
  operand: "name",
  options: { message: "string" },
  help: sendHelp,
  run: send,
};

const checkCommand: Command = {
  summary:
    "report each writer or judge pane that session spawn did not start, since it runs without its role token (read-only)",
  help: checkHelp,
  run: check,
};

const closeCommand: Command = {
  summary:
    "close a spawned session's pane once its result is recorded; --remove-worktree also removes its merged worktree and branch",
  operand: "name",
  options: { "remove-worktree": "boolean" },
  help: closeHelp,
  run: close,
};

const tierCommand: Command = {
  summary:
    "print the model and effort a role launches at, read from its agent definition (read-only)",
  operand: "role",
  help: tierHelp,
  run: tier,
};

const equalizeCommand: Command = {
  summary:
    "equalize the heights of the spawned panes in the column beside the caller's pane",
  help: equalizeHelp,
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
  send: sendCommand,
  check: checkCommand,
  close: closeCommand,
  tier: tierCommand,
  equalize: equalizeCommand,
  exec: execCommand,
};
export { resolveTier } from "./agent-definition.js";
