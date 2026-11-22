import pkg from "../../package.json" with { type: "json" };
import type { Command, CommandHelp } from "../runtime/index.js";
import { harnessWait } from "./wait-command.js";

const versionHelp: CommandHelp = {
  purpose:
    "Prints the harness's package version, the build number a bug report or a pinned check names.",
  when: "When you need to know which build of the harness is running.",
  whenNot:
    "When you need the state of the work rather than the build; use harness status.",
  flags: {},
  examples: [
    {
      command: "harness harness version",
      shows: "the package version, such as harness 0.22.0",
    },
  ],
  exits: [{ code: 0, meaning: "the version is printed" }],
  effects: {
    kind: "read-only",
    detail: "prints the version and changes nothing",
  },
  seeAlso: ["status"],
};

const version: Command = {
  summary: "print the harness version",
  help: versionHelp,
  run({ json, deps }) {
    deps.stdout(
      json
        ? `${JSON.stringify({ version: pkg.version })}\n`
        : `harness ${pkg.version}\n`,
    );
    return Promise.resolve(0);
  },
};

const waitHelp: CommandHelp = {
  purpose:
    "Waits in the background for the first of several things to settle: a pull request's checks, a spawned session's RESULT line, or an idea's state change in the ledger. It names the one that settled and the targets to restart with.",
  when: "When the main session has pull requests, spawned sessions or ideas to act on as they settle, and should not poll them one by one.",
  whenNot:
    "When one read is enough: use pr checks, session wait or ledger list for a single target.",
  flags: {
    timeout:
      "The bound in milliseconds; the default is one hour. When it passes with nothing settled, the command exits 3.",
    pr: "A pull request number to watch; repeat the flag to watch several.",
    session:
      "A spawned session's name to watch for its RESULT line; repeat the flag to watch several.",
    idea: "An idea's name to watch for a state change in the ledger; repeat the flag to watch several.",
    "any-idea": "Watch every idea for a state change in the ledger.",
  },
  examples: [
    {
      command: "harness harness wait --pr 942",
      shows: "PR 942's checks settled, or exit 3 once the bound passes",
    },
    {
      command: "harness harness wait --session build --timeout 600000",
      shows: "session build's RESULT line, or exit 3 after ten minutes",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "a target settled; the output names it and the targets to restart with",
    },
    {
      code: 1,
      meaning: "a target could not be read, or a session could not be opened",
    },
    {
      code: 2,
      meaning: "a usage error: no target, or a value that is not valid",
    },
    {
      code: 3,
      meaning:
        "the bound passed with nothing settled; the output names what is pending",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "a session that shows its RESULT line is recorded as finished, with its pane.finished ledger event; pull requests and ideas are only read",
  },
  seeAlso: ["pr checks", "session wait", "ledger list"],
};

/** The harness domain: its version, and the one background wait over pull requests and panes (ADR 0123). */
export const harnessCommands: Record<string, Command> = {
  version,
  wait: { ...harnessWait, help: waitHelp },
};
