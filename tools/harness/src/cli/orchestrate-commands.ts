import {
  HarnessCli,
  HarnessCliError,
  IdeaRun,
  RETRO_MODEL,
  RetroLaunch,
  retroFlagOn,
  type Measured,
} from "../orchestrator/index.js";
import type { Command, CommandContext } from "../runtime/index.js";

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
    const harness = new HarnessCli(deps.runner, root);
    const launch = new RetroLaunch({
      flagOn: () => retroFlagOn(deps.fs, root),
      due: () => harness.retroDue(),
      record: (reason) => harness.retroRecord(reason),
      spawn: (pane) => harness.spawnRetro(pane),
    });
    // Between pieces of work: the run has ended and every pane is closed.
    const betweenWork = async () => {
      const started = await launch.run();
      if (started.status === "launched") {
        deps.stderr(
          `Started retro pane ${started.name} (${started.reason}) on ${RETRO_MODEL}; collect it with \`session wait ${started.name}\`.\n`,
        );
      }
    };
    const result = await new IdeaRun(harness, betweenWork).run(idea, outcome);
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

const runCommand: Command = {
  summary:
    "drive one approved idea to a recorded outcome through the existing tools: writer, then judge, repeated while the change is sent back, the writer relaunched on Sonnet after two send-backs; runs `judge precheck` before it launches any judge pane and, when the precheck fails on something the writer can fix (no valid declaration, a failed check, a pattern mismatch), sends a failing change back to its writer with the precheck's reason through `judge send-back`, launching no judge pane; a check still pending or a review not yet posted does not send it back, and a pass launches the judge as before; a precheck send-back is the judge send-back event, counted once per PR head; reads the queue only between pieces of work, never merges or edits, and records the outcome through `outcome record` only when all five outcome flags are given, so an idea with no outcome is never closed; once the run has ended and no pane is left running, starts a retro pane on Opus when `retro due` says one is due and the local `automatic-retro` flag is on, recording the trigger through `retro record` first and never launching twice for one trigger; exits 1 unless the outcome is recorded (--idea [--kind --source --result --evidence --summary, as for `outcome record`])",
  options: {
    idea: "string",
    kind: "string",
    source: "string",
    result: "string",
    evidence: "string",
    summary: "string",
  },
  run: runIdea,
};

export const orchestrateCommands: Record<string, Command> = {
  run: runCommand,
};
