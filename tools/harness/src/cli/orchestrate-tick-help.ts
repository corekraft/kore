import type { CommandHelp } from "../runtime/index.js";

/** The orchestrate tick's help record; it sits here so orchestrate-tick.ts stays under its line limit. */
export const tickHelp: CommandHelp = {
  purpose:
    "Advances each approved idea by at most one step in one pass: starts its writer, closes a finished pane, runs the precheck and the judge, and relaunches a writer after a send-back. It advances nothing unless the local orchestrator-tick flag is on.",
  when: "When the orchestrator-tick flag is on and approved ideas should move on: run one pass, or with --loop run passes in the background. When one approved idea should run to its recorded outcome in this terminal: give --idea with --loop.",
  whenNot:
    "When the outcome is not known yet, give none of the five outcome flags: the one-idea run stops after the merge and exits 1. For the loop's restart job, use --install and let the owner start it.",
  flags: {
    idea: "Scopes the pass to one idea, such as 0007, as queue next lists it. With --loop it runs that idea to its end instead of looping in the background.",
    loop: "Runs passes one after another until the flag is turned off, each as a child process, so a failing pass ends only itself. With --idea it runs passes scoped to that idea until it ends, then exits.",
    install:
      "Writes the owner's launchd restart job for the loop, behind the flag, and starts nothing; the owner loads it.",
    kind: "The outcome's kind, as outcome record takes it; only with --idea and --loop. Give all five outcome flags or none.",
    source: "The outcome's source, as outcome record takes it.",
    result:
      "The outcome's result, as outcome record takes it: confirmed, refuted or inconclusive.",
    evidence:
      "The evidence reference the outcome cites, as outcome record takes it.",
    summary: "One line summarising the outcome, as outcome record takes it.",
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
      command: "harness orchestrate tick --idea 0007 --loop",
      shows:
        "the idea driven through its writer and judge to the merge, then stopped at awaiting-outcome with exit 1, since no outcome was given",
    },
    {
      command:
        "harness orchestrate tick --idea 0007 --loop --kind experiment --source live-run --result confirmed --evidence '<reference>' --summary 'the change held'",
      shows: "the idea driven to the merge, its outcome recorded, and exit 0",
    },
    {
      command: "harness orchestrate tick --idea 0007 --loop --json",
      shows: "the final status and the round count, as one object",
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
        "a pass ran and its steps were printed, the flag was off, another tick held the lease, the loop ended, or a one-idea run recorded its outcome (outcome-recorded)",
    },
    {
      code: 1,
      meaning:
        "a tick error named on stderr, such as a rejected ledger event; or --install with the flag off; a one-idea run (--idea with --loop) that ended with any other status: not-queued (the idea is not in the queue), blocked (a step could not run), awaiting-outcome (merged with no outcome flags), gave-up (six rounds without a merge); an empty --idea; only some of the five outcome flags; or outcome flags without both --idea and --loop",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "with the flag on, starts, closes and messages panes, appends tick events to the ledger, comments on and labels issues (a ticket's waiting notice, or needs-info with its reason), starts writers in their own worktrees under .claude/worktrees, records tick.self-update-failed when the rebuild fails, and takes a per-machine lease in the host lock directory; a start held back by power, load or a live run is a tick.bound event. With --loop and the tick-self-update flag on, each pass first fast-forwards a clean main to origin/main (git fetch, then git pull --ff-only) and rebuilds the harness bundle; a refusal keeps the bundle it has. --install writes a launchd plist under the home LaunchAgents folder and starts nothing. It never pushes or merges a branch. With the flag off a pass writes nothing. A one-idea run (--idea with --loop) records the outcome through outcome record only when all five outcome flags are given, and never merges or edits: the judge merges. With orchestrator-tick on its passes run under the lease and no retro starts. With orchestrator-tick off it runs the idea itself: starts and closes writer and judge panes, runs review run, then runs judge precheck before it launches any judge pane; a failing precheck sends the change back to its writer through judge send-back with the precheck's reason and category, launching no judge pane. A send-back is counted once per PR head toward the writer's escalation, which relaunches on Sonnet after two. With automatic-retro on, when that run ends it starts a retro pane on Sonnet at high effort if retro due says one is due, recording the trigger through retro record first; the pane's proposals are filed through idea new, which checks the whole batch and files nothing when one item is malformed, files at most 5, and keys each on the retro's trigger id plus a content hash so a rerun files nothing new",
  },
  seeAlso: ["orchestrate plan", "outcome record", "queue next", "status"],
};
