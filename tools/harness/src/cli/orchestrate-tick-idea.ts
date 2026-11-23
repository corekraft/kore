import {
  HarnessCli,
  HarnessCliError,
  IdeaRun,
  tickFlagOn,
  type Measured,
  type RunResult,
} from "../orchestrator/index.js";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import { retroHook } from "./orchestrate-retro.js";

const FAILED = 1;
export const OUTCOME_FLAGS = [
  "kind",
  "source",
  "result",
  "evidence",
  "summary",
] as const;

/** Runs passes scoped to one idea until it ends; `orchestrate tick` wires it, so this file never imports the tick. */
export type RunOnTicks = (
  deps: CliDeps,
  root: string,
  idea: string,
  outcome: Measured | undefined,
) => Promise<RunResult>;

const text = (options: CommandContext["options"], key: string) => {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
};

/** Whether any of the five outcome flags was given. */
export const hasOutcomeFlags = (options: CommandContext["options"]) =>
  OUTCOME_FLAGS.some((k) => text(options, k) !== undefined);

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

/**
 * `orchestrate tick --idea <n> --loop`: drives one approved idea to a recorded
 * outcome (ADR 0121). With the orchestrator-tick flag on it runs ticks scoped to
 * the idea; with it off, the idea's writer and judge run through the harness tools.
 */
export async function runIdea(
  context: CommandContext,
  root: string,
  idea: string,
  onTicks: RunOnTicks,
): Promise<number> {
  const { deps, json, options } = context;
  const fail = (message: string) => {
    const prefix = json ? `${JSON.stringify({ error: message })}\n` : "";
    deps.stderr(`${prefix}${message}\n`);
    return FAILED;
  };
  if (idea.trim() === "") {
    return fail(
      "Empty --idea; pass the idea number from `harness queue next`.",
    );
  }
  const outcome = outcomeOf(options);
  if (outcome !== undefined && "error" in outcome) {
    return fail(outcome.error);
  }
  try {
    const result = (await tickFlagOn(deps.fs, root))
      ? await onTicks(deps, root, idea.trim(), outcome)
      : await legacyRun(deps, root, idea.trim(), outcome);
    deps.stdout(
      json
        ? `${JSON.stringify(result)}\n`
        : `Idea ${idea.trim()}: ${result.status} after ${result.rounds} round${result.rounds === 1 ? "" : "s"}.\n`,
    );
    return result.status === "outcome-recorded" ? 0 : FAILED;
  } catch (error) {
    if (!(error instanceof HarnessCliError)) {
      throw error;
    }
    return fail(error.message);
  }
}

function legacyRun(
  deps: CliDeps,
  root: string,
  idea: string,
  outcome: Measured | undefined,
): Promise<RunResult> {
  const harness = new HarnessCli(deps.runner, root);
  return new IdeaRun(harness, retroHook(deps, root, harness)).run(
    idea,
    outcome,
  );
}
