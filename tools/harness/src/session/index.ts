// oxlint-disable import/max-dependencies -- the session domain is one command per module, so its barrel imports each of them
import type { Command } from "../runtime/index.js";
export { buildBrief } from "./brief.js";
export { FOLLOW_UP_PREFIX } from "./follow-up-prefix.js";
export { parseTimeout } from "./wait.js";
export {
  openSessionTarget,
  settleSessionTarget,
  type OpenedTarget,
  type SessionWaitTarget,
} from "./wait-target.js";
export { hostLeaseRefusal } from "./host-lease.js";
export { signedMainSendsOn } from "./signed-sends.js";
export { sessionNameError } from "./names.js";
export { spawnLoadRefusal } from "./spawn-load.js";
export { PASSED_FLAGS, namesFlag } from "./exec.js";
export { readRoleAgent } from "./exec-agent.js";
export {
  SessionRegistry,
  type SessionRecord,
  type SessionRecords,
  type UnreadableRecord,
} from "./registry.js";
export { recordsOfTerminal, type TerminalRecords } from "./terminal-record.js";
export { terminalsFor } from "./backend.js";
export { startLedgerWatch } from "./spawn-hc-watch.js";
export { readReport, reportPath } from "./report-file.js";
export { findResult } from "./result-marker.js";
import { check, checkHelp } from "./check.js";
import { close, closeHelp } from "./close.js";
import { execCommand } from "./exec.js";
import { report, reportHelp } from "./report.js";
import { send, sendHelp } from "./send.js";
import { spawnHc } from "./spawn-hc.js";
import { spawnHelp } from "./spawn-help.js";
import { tier, tierHelp } from "./tier.js";
import { wait, waitHelp } from "./wait.js";

const spawnCommand: Command = {
  summary:
    "start a Claude session as one hc terminal under the caller's terminal, named, briefed and recorded; collect its result with session wait",
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
  run: spawnHc,
};

const waitCommand: Command = {
  summary:
    "wait for a spawned session to settle and print its outcome: it settles on its report file, and --json prints {name, model, outcome, summary, seq}, with seq absent when it settled without a report",
  operand: "name",
  options: { timeout: "string" },
  help: waitHelp,
  run: wait,
};

const reportCommand: Command = {
  summary:
    "record this hc session's outcome: writes .kore/report/<session>.json with the next seq, then sends the parent one notice line (--outcome done|blocked, and exactly one of --summary <text> (or - for stdin) or --file <path>, a file under .kore/report; --plan <file> (or - for stdin) stores its text with the report); the last action of a session that session spawn started",
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
    "send a one-line follow-up to a spawned session on its terminal when the caller may reach it (parent, child or group sibling)",
  operand: "name",
  options: { message: "string" },
  help: sendHelp,
  run: send,
};

const checkCommand: Command = {
  summary:
    "report each agent terminal that session spawn did not start, and each report with no open record (read-only)",
  help: checkHelp,
  run: check,
};

const closeCommand: Command = {
  summary:
    "close a spawned session: kill its terminal from the parent terminal once its result is recorded; --force-record removes a record whose terminal is not live in hc; --remove-worktree is refused on hc",
  operand: "name",
  options: { "remove-worktree": "boolean", "force-record": "boolean" },
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

/** The `session` domain: commands that run other Claude sessions as hc terminals. */
export const session: Record<string, Command> = {
  spawn: spawnCommand,
  wait: waitCommand,
  report: reportCommand,
  send: sendCommand,
  check: checkCommand,
  close: closeCommand,
  tier: tierCommand,
  exec: execCommand,
};
export { resolveTier } from "./agent-definition.js";
