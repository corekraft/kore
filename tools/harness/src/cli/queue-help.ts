import type { Command, CommandHelp } from "../runtime/index.js";
import {
  escalateCommand,
  nextCommand,
  sendBacksCommand,
} from "./queue-commands.js";

/**
 * The queue domain's table: each command with its help record. The records sit here, not in
 * queue-commands.ts, so that file stays under its line and import limits.
 */

export const nextHelp: CommandHelp = {
  purpose:
    "Lists what the orchestrator should work on next, oldest first: approved ideas without an outcome and the judge's pending send-backs. With the local tick-ticket-queue flag on, it lists the whole frontier, numbered in queue order, instead.",
  when: "When you need to know what the tick takes next, or why one issue is not queued (with --explain).",
  whenNot:
    "When you need one PR's send-back count and the writer model to launch: use queue send-backs. To act on the queue, run orchestrate tick.",
  flags: {
    ledger:
      "The stage ledger to read send-backs from, relative to the working directory. Without it, the shared ledger of the main checkout.",
    explain:
      "An issue number: places that issue in the frontier, or names why it is excluded. Needs the tick-ticket-queue flag on.",
  },
  examples: [
    {
      command: "harness queue next",
      shows:
        "the approved ideas and send-backs, oldest first, or the line that the queue is empty",
    },
    {
      command: "harness queue next --explain 1797",
      shows: "where issue 1797 sits in the frontier, or why it is excluded",
    },
    {
      command: "harness queue next --json",
      shows:
        "the queue as one object; with tick-ticket-queue on, also the excluded issues",
    },
  ],
  exits: [
    { code: 0, meaning: "the queue was listed, or the issue explained" },
    {
      code: 1,
      meaning:
        "the queue could not be read: no main checkout for the ledger, a bad --explain value, --explain with the flag off, or a read of gh, the ledger or the idea records failed",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the ledger, the idea records and GitHub's issues and pull requests; writes nothing",
  },
  seeAlso: ["queue send-backs", "queue escalate", "orchestrate tick"],
};

export const sendBacksHelp: CommandHelp = {
  purpose:
    "Counts a PR's judge send-backs from the ledger and names the model to launch its writer on: the writer's declared default model below two send-backs, claude-sonnet-5-5 from two.",
  when: "Before relaunching a PR's writer after a judge send-back, to see which model to launch it on.",
  whenNot:
    "When you mean to record an escalation: use queue escalate, which records it once. This command only reads.",
  flags: {
    ledger:
      "The stage ledger to read send-backs from, relative to the working directory. Without it, the shared ledger of the main checkout.",
  },
  operand: "The pull request number, such as 746.",
  examples: [
    {
      command: "harness queue send-backs 746",
      shows: "PR 746's send-back count and the model to launch its writer on",
    },
    {
      command: "harness queue send-backs 746 --json",
      shows:
        "the pr, count, model and whether the writer escalates, as one object",
    },
  ],
  exits: [
    { code: 0, meaning: "the count and model were printed" },
    {
      code: 1,
      meaning:
        "the PR number is missing or not a whole number, or the ledger or the writer's declared model cannot be read",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the ledger's send-back events and the writer's declared model; writes nothing",
  },
  seeAlso: ["queue escalate", "queue next", "session spawn"],
};

export const escalateHelp: CommandHelp = {
  purpose:
    "Records the escalation of a PR's writer once the PR has two send-backs, one escalation per PR, and prints the spawn line that relaunches the writer on the stronger model.",
  when: "After a PR's second judge send-back, before relaunching its writer.",
  whenNot:
    "Below two send-backs it refuses: relaunch the writer on its default model, which queue send-backs names. It starts nothing itself; run the spawn line it prints.",
  flags: {
    ledger:
      "The stage ledger to record the escalation in, relative to the working directory. Without it, the shared ledger of the main checkout.",
  },
  operand: "The pull request number, such as 746.",
  examples: [
    {
      command: "harness queue escalate 746",
      shows:
        "the escalation recorded for PR 746, and the session spawn line that relaunches its writer on claude-sonnet-5-5",
    },
    {
      command: "harness queue escalate 746 --json",
      shows: "the pr, count, model and escalated set to true, as one object",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the escalation is recorded, or was already recorded for this PR",
    },
    {
      code: 1,
      meaning:
        "refused: fewer than two send-backs, the PR number is missing or not a whole number, the ledger cannot be read, or the escalation event was rejected",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "appends one escalation event to the ledger for this PR, labelled with the model, unless one is already there; starts no pane",
  },
  seeAlso: ["queue send-backs", "session spawn", "queue next"],
};

/** The queue domain's commands, each with its help record; the command table reads them from here. */
export const queueDomain: Record<string, Command> = {
  next: { ...nextCommand, help: nextHelp },
  "send-backs": { ...sendBacksCommand, help: sendBacksHelp },
  escalate: { ...escalateCommand, help: escalateHelp },
};
