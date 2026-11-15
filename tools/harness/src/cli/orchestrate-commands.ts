import {
  HarnessCli,
  HarnessCliError,
  IdeaRun,
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
    const harness = new HarnessCli(deps.runner, await deps.root());
    const result = await new IdeaRun(harness).run(idea, outcome);
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
    "drive one approved idea to a recorded outcome through the existing tools: writer, then judge, repeated while the judge sends the change back, the writer relaunched on Sonnet after two send-backs; reads the queue only between pieces of work, never merges, edits or messages the concierge, and records the outcome through `outcome record` only when all five outcome flags are given, so an idea with no outcome is never closed; exits 1 unless the outcome is recorded (--idea [--kind --source --result --evidence --summary, as for `outcome record`])",
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
