import {
  HarnessCli,
  HarnessCliError,
  IdeaRun,
  tickFlagOn,
  type Measured,
} from "../orchestrator/index.js";
import { retroHook } from "./orchestrate-retro.js";
import { planCommand } from "./orchestrate-plan.js";
import { runOnTicks, tickCommand } from "./orchestrate-tick.js";
import { tickHelp } from "./orchestrate-tick-help.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import { briefBackend } from "../session/index.js";

const FAILED = 1;
const OUTCOME_FLAGS = [
  "kind",
  "source",
  "result",
  "evidence",
  "summary",
] as const;

const text = (options: CommandContext["options"], key: string) => {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
};

/** The outcome flags as one outcome, none when none are given, or an error when only some are. */
function outcomeOf(
  options: CommandContext["options"],
): Measured | undefined | { error: string } {
  const given = OUTCOME_FLAGS.filter((k) => text(options, k) !== undefined);
  if (given.length === 0) {
    return undefined;
  }
  if (given.length < OUTCOME_FLAGS.length) {
    const missing = OUTCOME_FLAGS.filter((k) => !given.includes(k));
    return {
      error: `Incomplete outcome: also pass ${missing.map((k) => `--${k}`).join(", ")}, or none of them to stop after the merge.`,
    };
  }
  // `outcome record` validates the values; the orchestrator only carries them.
  return Object.fromEntries(
    OUTCOME_FLAGS.map((k) => [k, text(options, k)]),
  ) as unknown as Measured;
}

async function runIdea(context: CommandContext): Promise<number> {
  const { deps, json, options } = context;
  const fail = (message: string) => {
    const prefix = json ? `${JSON.stringify({ error: message })}\n` : "";
    deps.stderr(`${prefix}${message}\n`);
    return FAILED;
  };
  const idea = text(options, "idea")?.trim();
  if (idea === undefined || idea === "") {
    return fail(
      "Missing --idea; run `harness orchestrate run --idea <number>`, with the idea number from `harness queue next`.",
    );
  }
  const outcome = outcomeOf(options);
  if (outcome !== undefined && "error" in outcome) {
    return fail(outcome.error);
  }
  try {
    const root = await deps.root();
    const harness = new HarnessCli(deps.runner, root, await briefBackend(deps));
    const result = (await tickFlagOn(deps.fs, root))
      ? await runOnTicks(deps, root, idea, outcome)
      : await new IdeaRun(harness, retroHook(deps, root, harness)).run(
          idea,
          outcome,
        );
    deps.stdout(
      json
        ? `${JSON.stringify(result)}\n`
        : `Idea ${idea}: ${result.status} after ${result.rounds} round${result.rounds === 1 ? "" : "s"}.\n`,
    );
    return result.status === "outcome-recorded" ? 0 : FAILED;
  } catch (error) {
    if (!(error instanceof HarnessCliError)) {
      throw error;
    }
    return fail(error.message);
  }
}

const runHelp: CommandHelp = {
  purpose:
    "Drives one approved idea to a recorded outcome: its writer, then its judge, repeated while the change is sent back. It records the outcome only when all five outcome flags are given.",
  when: "When one approved idea should run through its writer and judge in this terminal, and its outcome is known.",
  whenNot:
    "When every approved idea should advance on its own: use orchestrate tick. When the outcome is not known yet, give none of the five outcome flags: the run stops after the merge and exits 1.",
  flags: {
    idea: "The idea number, as queue next lists it, such as 0007. Required.",
    kind: "The outcome's kind, as outcome record takes it. Give all five outcome flags or none.",
    source: "The outcome's source, as outcome record takes it.",
    result:
      "The outcome's result, as outcome record takes it: confirmed, refuted or inconclusive.",
    evidence:
      "The evidence reference the outcome cites, as outcome record takes it.",
    summary: "One line summarising the outcome, as outcome record takes it.",
  },
  examples: [
    {
      command: "harness orchestrate run --idea 0007",
      shows:
        "the idea driven through its writer and judge to the merge, then stopped at awaiting-outcome with exit 1, since no outcome was given",
    },
    {
      command:
        "harness orchestrate run --idea 0007 --kind experiment --source live-run --result confirmed --evidence '<reference>' --summary 'the change held'",
      shows: "the idea driven to the merge, its outcome recorded, and exit 0",
    },
    {
      command: "harness orchestrate run --idea 0007 --json",
      shows: "the final status and the round count, as one object",
    },
  ],
  exits: [
    { code: 0, meaning: "the outcome was recorded (outcome-recorded)" },
    {
      code: 1,
      meaning:
        "any other status, or a refused input: not-queued (the idea is not in the queue), blocked (a step could not run), awaiting-outcome (merged with no outcome flags), gave-up (six rounds without a merge); a missing --idea, or only some of the five outcome flags",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "starts and closes writer and judge panes, runs review run, then runs judge precheck before it launches any judge pane; a failing precheck sends the change back to its writer through judge send-back with the precheck's reason and category, launching no judge pane. A send-back is counted once per PR head toward the writer's escalation, which relaunches on Sonnet after two. Records the outcome through outcome record only when all five flags are given, and never merges or edits: the judge merges. With automatic-retro on and orchestrator-tick off, when the run ends it starts a retro pane on Sonnet at high effort if retro due says one is due, recording the trigger through retro record first; the pane's proposals are filed through idea new, which checks the whole batch and files nothing when one item is malformed, files at most 5, and keys each on the retro's trigger id plus a content hash so a rerun files nothing new. With orchestrator-tick on, passes of orchestrate tick scoped to this idea run instead, and no retro starts",
  },
  seeAlso: ["orchestrate tick", "outcome record", "queue next"],
};

const runCommand: Command = {
  summary:
    "Drives one approved idea through its writer and judge to a recorded outcome.",
  options: {
    idea: "string",
    kind: "string",
    source: "string",
    result: "string",
    evidence: "string",
    summary: "string",
  },
  help: runHelp,
  run: runIdea,
};

export const orchestrateCommands: Record<string, Command> = {
  run: runCommand,
  tick: { ...tickCommand, help: tickHelp },
  plan: planCommand,
};
