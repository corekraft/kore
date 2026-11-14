import type { CliDeps, RunResult } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import { displayName, modelOnScreen, type ModelCheck } from "./models.js";

const MODEL_BOUND_MS = 5_000;
const RETRY_MS = 500;
/** Starts tried before giving up; a fresh pane's shell is often not ready for the first few. */
const START_TRIES = 10;
/** The fixed pause between tries of a fast failure, and the first backoff step after a timeout. */
const START_PAUSE_MS = 1_000;
/** The most time spent pausing across the backoff after a timeout. */
const START_BUDGET_MS = 60_000;
/** A host load average this far above 1 per step doubles the pause, so a busier host waits longer. */
const LOAD_PER_STEP = 8;

/**
 * Whether a failed start says it timed out. herdr's own wording is not pinned
 * in this repository, so this matches the common forms of the word.
 */
function timedOut(result: RunResult): boolean {
  return /time ?d? ?out/i.test(`${result.stdout}\n${result.stderr}`);
}

/**
 * The backoff pause after a timed-out try, `steps` tries after the first
 * timeout (0 for the timeout's own try), or undefined when the wait budget is
 * spent. It doubles per step and scales with the host load (never below the
 * unscaled pause), and is cut short so the total never passes the budget.
 */
function backoffPause(
  steps: number,
  waited: number,
  load: number,
): number | undefined {
  const remaining = START_BUDGET_MS - waited;
  if (remaining <= 0) {
    return undefined;
  }
  const scale = Number.isFinite(load) ? Math.max(1, load / LOAD_PER_STEP) : 1;
  return Math.round(Math.min(START_PAUSE_MS * 2 ** steps * scale, remaining));
}

/** The host's load average, or infinity when no reader is injected or the host reports none. */
function hostLoadOf(deps: Pick<CliDeps, "hostLoad">): number {
  return deps.hostLoad?.oneMinute() ?? Number.POSITIVE_INFINITY;
}

/**
 * The pause before try `tries + 1`, or undefined to give up. A start that has
 * not timed out yet pauses one second, as before. From the first timeout on,
 * the pause is the backoff, which reads the host load.
 */
function pauseBeforeRetry(
  deps: Pick<CliDeps, "hostLoad">,
  firstTimeout: number | undefined,
  tries: number,
  waited: number,
): number | undefined {
  if (firstTimeout === undefined) {
    return START_PAUSE_MS;
  }
  return backoffPause(tries - firstTimeout, waited, hostLoadOf(deps));
}

/** The host load a message reports, or a note that it cannot be read; never a guessed value. */
function loadNote(load: number): string {
  return Number.isFinite(load)
    ? `The host 1-minute load average is ${load.toFixed(2)}, so the pane may not have started in time under load. Wait for the load to fall, then spawn again.`
    : "The host 1-minute load average cannot be read. Check the host load, then spawn again.";
}

/**
 * Starts the agent, retrying a failed start up to START_TRIES times, whatever
 * the failure (a fresh pane's shell is often not ready yet). A fast failure is
 * retried one second apart, as before. Once a start times out, the pauses from
 * that try on double, scaled by the host load, and stop once their total would
 * pass a minute; that failure names the try count, the elapsed wait, the last
 * failure, the host load and what to do. An error message, or undefined on success.
 */
export async function startAgent(
  deps: CliDeps,
  args: readonly string[],
): Promise<string | undefined> {
  let last = "";
  let waited = 0;
  let tries = 0;
  let firstTimeout: number | undefined;
  for (;;) {
    tries += 1;
    const start = await deps.runner.run("herdr", args);
    if (start.code === 0) {
      return undefined;
    }
    last = describeFailure(start);
    firstTimeout ??= timedOut(start) ? tries : undefined;
    const pause =
      tries < START_TRIES
        ? pauseBeforeRetry(deps, firstTimeout, tries, waited)
        : undefined;
    if (pause === undefined) {
      break;
    }
    await deps.clock.sleep(pause);
    waited += pause;
  }
  if (firstTimeout === undefined) {
    return `herdr agent start failed after ${START_TRIES} tries: ${last}`;
  }
  const seconds = Math.round(waited / 1_000);
  return `herdr agent start failed after ${tries} tries over ${seconds} s of waiting: ${last}. ${loadNote(hostLoadOf(deps))}`;
}

/**
 * Compares the model the pane shows with the requested one. A mismatch is an
 * error message naming both; a name that never appears is reported as
 * unverified with the reason, never as a pass.
 */
export async function checkModel(
  deps: CliDeps,
  name: string,
  model: string,
): Promise<ModelCheck | { mismatch: string }> {
  const expected = displayName(model);
  if (expected === undefined) {
    return {
      status: "unverified",
      reason: `No display name is known for ${model}, so the pane's model could not be confirmed.`,
    };
  }
  const deadline = deps.clock.now().getTime() + MODEL_BOUND_MS;
  for (;;) {
    const read = await deps.runner.run("herdr", [
      "agent",
      "read",
      name,
      "--source",
      "visible",
    ]);
    const seen = modelOnScreen(model, read.code === 0 ? read.stdout : "");
    if (seen.status === "verified") {
      return { status: "verified" };
    }
    if (seen.status === "mismatch") {
      return {
        mismatch: `Session ${name} runs "${seen.seen}" but ${model} ("${expected}") was requested.`,
      };
    }
    if (deps.clock.now().getTime() >= deadline) {
      return {
        status: "unverified",
        reason: `The pane showed no model name, such as "${expected}", within ${MODEL_BOUND_MS / 1000} seconds, so ${model} could not be confirmed.`,
      };
    }
    await deps.clock.sleep(RETRY_MS);
  }
}
