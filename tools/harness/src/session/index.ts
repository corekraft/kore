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
export {
  SessionRegistry,
  type SessionRecord,
  type SessionRecords,
  type UnreadableRecord,
} from "./registry.js";
export { recordsOfTerminal, type TerminalRecords } from "./terminal-record.js";
import { check, checkHelp } from "./check.js";
import { close, closeHelp } from "./close.js";
import { execCommand } from "./exec.js";
import { equalize, equalizeHelp } from "./equalize.js";
import { notify, notifyHelp } from "./notify.js";
import { report, reportHelp } from "./report.js";
import { send, sendHelp } from "./send.js";
import { spawnHelp } from "./spawn.js";
import { spawnRouted } from "./spawn-route.js";
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
    group: "string",
  },
  help: spawnHelp,
  run: spawnRouted,
};

const waitCommand: Command = {
  summary:
    "wait for a spawned session to finish and print its outcome. An hc session settles on its report file, and --json prints {name, model, outcome, summary, seq}, with seq absent when it settled without a report; a herdr session waits for its RESULT line, and --json adds result.summary, the text the pane printed before it",
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

const reportCommand: Command = {
  summary:
    "record this hc session's outcome: writes .kore/report/<session>.json with the next seq, then sends the parent one notice line (--outcome done|blocked, and exactly one of --summary <text> or --file <path>, a file under .kore/report; --plan <file> stores its text with the report); the last action of a session that session spawn started on hc",
  options: {
    outcome: "string",
    summary: "string",
    file: "string",
    plan: "string",
  },
  help: reportHelp,
  run: report,
};

const sendCommand: Command = {
  summary:
    "send a one-line follow-up to a spawned session: to its herdr pane (signed and recorded), or on hc to its terminal when the caller may reach it (parent, child or group sibling)",
  operand: "name",
  options: { message: "string" },
  help: sendHelp,
  run: send,
};

const checkCommand: Command = {
  summary:
    "report each writer or judge pane (herdr) or each agent terminal (hc-sessions on) that session spawn did not start, and on hc each report with no open record (read-only)",
  help: checkHelp,
  run: check,
};

const closeCommand: Command = {
  summary:
    "close a spawned session: its herdr pane once its result is recorded, or on hc its terminal from the parent terminal; --remove-worktree also removes its merged worktree and branch (herdr only)",
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
  report: reportCommand,
  send: sendCommand,
  check: checkCommand,
  close: closeCommand,
  tier: tierCommand,
  equalize: equalizeCommand,
  exec: execCommand,
};
export { resolveTier } from "./agent-definition.js";
