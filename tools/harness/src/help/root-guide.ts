import type { RootGuide } from "./guide.js";

/** The root guide: what the harness is, the three common flows as data (every step a real command), and how to go deeper. */
export const rootGuide: RootGuide = {
  what: "The harness is the repository's command-line tool for the delivery loop: ideas, plans, sessions, pull requests, flags and the stage ledger.",
  flows: [
    {
      name: "spawn, wait, close",
      steps: ["session spawn", "session wait", "session close"],
    },
    { name: "pr open, checks", steps: ["pr open", "pr checks"] },
    { name: "flag audit, activate", steps: ["flag audit", "flag activate"] },
  ],
  deeper:
    "Run `harness <domain> --help` for a domain's commands, then `harness <domain> <command> --help` for one command.",
};
