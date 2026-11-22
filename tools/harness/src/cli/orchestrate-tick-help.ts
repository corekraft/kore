import type { CommandHelp } from "../runtime/index.js";

/** The orchestrate tick's help record; it sits here so orchestrate-tick.ts stays under its line limit. */
export const tickHelp: CommandHelp = {
  purpose:
    "Advances each approved idea by at most one step in one pass: starts its writer, closes a finished pane, runs the precheck and the judge, and relaunches a writer after a send-back. It advances nothing unless the local orchestrator-tick flag is on.",
  when: "When the orchestrator-tick flag is on and approved ideas should move on: run one pass, or with --loop run passes in the background.",
  whenNot:
    "When one idea should run to its outcome in this terminal: use orchestrate run. For the loop's restart job, use --install and let the owner start it.",
  flags: {
    idea: "Scopes the pass to one idea, such as 0007.",
    loop: "Runs passes one after another until the flag is turned off, each as a child process, so a failing pass ends only itself.",
    install:
      "Writes the owner's launchd restart job for the loop, behind the flag, and starts nothing; the owner loads it.",
  },
  examples: [
    {
      command: "harness orchestrate tick",
      shows:
        "one pass: a line for each idea advanced, such as its writer starting, or the message that the flag is off",
    },
    {
      command: "harness orchestrate tick --idea 0007",
      shows: "one pass limited to idea 0007",
    },
    {
      command: "harness orchestrate tick --loop",
      shows:
        "passes repeated, each bracketed by tick.started and tick.stopped events, until the flag is turned off",
    },
    {
      command: "harness orchestrate tick --install",
      shows:
        "the restart job written under the LaunchAgents folder, and the launchctl line the owner runs to start it",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "a pass ran and its steps were printed, the flag was off, another tick held the lease, or the loop ended",
    },
    {
      code: 1,
      meaning:
        "a tick error named on stderr, such as a rejected ledger event; or --install with the flag off",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "with the flag on, starts, closes and messages panes, appends tick events to the ledger, comments on and labels issues (a ticket's waiting notice, or needs-info with its reason), starts writers in their own worktrees under .claude/worktrees, records tick.self-update-failed when the rebuild fails, and takes a per-machine lease in the host lock directory; a start held back by power, load or a live run is a tick.bound event. With --loop and the tick-self-update flag on, each pass first fast-forwards a clean main to origin/main (git fetch, then git pull --ff-only) and rebuilds the harness bundle; a refusal keeps the bundle it has. --install writes a launchd plist under the home LaunchAgents folder and starts nothing. It never pushes or merges a branch. With the flag off it writes nothing",
  },
  seeAlso: ["orchestrate run", "orchestrate plan", "queue next", "status"],
};
