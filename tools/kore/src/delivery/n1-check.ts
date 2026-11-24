// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// The N-1 check of a release that adds migrations: the new migrations are applied to a scratch
// database, and the previous release's suite runs against it. The eval stays offline and read-only
// because the caller supplies the two executables and the scratch database; the eval creates and
// destroys nothing.
import { CommandError, type Runner, type RunResult } from "../runtime/index.js";

export interface N1Inputs {
  runner: Runner;
  /** The app directory, which both steps run in. */
  dir: string;
  /** The environment the steps inherit; DATABASE_URL is added to it. */
  baseEnv: NodeJS.ProcessEnv;
  /** The executable that applies the new migrations to the scratch database. */
  apply?: string | undefined;
  /** The executable that runs the previous release's suite against the scratch database. */
  previousSuite?: string | undefined;
  /** The scratch database URL, from KORE_EVAL_SCRATCH_DATABASE_URL; never printed. */
  databaseUrl?: string | undefined;
}

const REDACTED = "<redacted>";

/**
 * Runs the two steps in order and returns the failures: none when both pass. The first failing step
 * stops the check. Missing inputs fail the check without running anything, so a release that needs
 * the check never skips it.
 */
export async function n1Check(inputs: N1Inputs | undefined): Promise<string[]> {
  const { apply, previousSuite, databaseUrl } = inputs ?? {};
  const missing = [
    apply === undefined ? "--n1-apply" : undefined,
    previousSuite === undefined ? "--n1-previous-suite" : undefined,
    databaseUrl === undefined ? "KORE_EVAL_SCRATCH_DATABASE_URL" : undefined,
  ].filter((name): name is string => name !== undefined);
  if (
    inputs === undefined ||
    apply === undefined ||
    previousSuite === undefined ||
    databaseUrl === undefined
  ) {
    return [
      `the N-1 check needs --n1-apply <executable>, --n1-previous-suite <executable> and KORE_EVAL_SCRATCH_DATABASE_URL; missing: ${missing.join(", ")}`,
    ];
  }
  const steps: [string, string][] = [
    ["applying the new migrations", apply],
    ["the previous release's suite", previousSuite],
  ];
  for (const [label, command] of steps) {
    const failure = await runStep(inputs, command, label, databaseUrl);
    if (failure !== undefined) {
      return [failure];
    }
  }
  return [];
}

/** One step's failure message, or undefined when it passed. Only a failed command is a failure. */
async function runStep(
  inputs: N1Inputs,
  command: string,
  label: string,
  databaseUrl: string,
): Promise<string | undefined> {
  try {
    await inputs.runner.run(command, [], {
      cwd: inputs.dir,
      env: { ...inputs.baseEnv, DATABASE_URL: databaseUrl },
    });
    return undefined;
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    return `N-1 check: ${label} failed (exit ${error.result.code}): ${output(error.result, databaseUrl)}`;
  }
}

/** The trimmed stderr, or stdout, with the scratch URL redacted, so the URL never reaches a report. */
function output(result: RunResult, databaseUrl: string): string {
  const text = result.stderr.trim() || result.stdout.trim() || "no output";
  return text.split(databaseUrl).join(REDACTED);
}
