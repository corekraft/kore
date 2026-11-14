import type { CliDeps } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import { displayName, modelOnScreen, type ModelCheck } from "./models.js";

const MODEL_BOUND_MS = 5_000;
const RETRY_MS = 500;
/** Starts tried before giving up; a fresh pane's shell is often not ready for the first few. */
const START_TRIES = 10;
const START_PAUSE_MS = 1_000;

/**
 * Starts the agent, retrying a failed start up to START_TRIES times one second
 * apart, whatever the failure (a fresh pane's shell is often not ready yet).
 * An error message naming the last failure, or undefined on success.
 */
export async function startAgent(
  deps: CliDeps,
  args: readonly string[],
): Promise<string | undefined> {
  let last = "";
  for (let attempt = 1; attempt <= START_TRIES; attempt++) {
    const start = await deps.runner.run("herdr", args);
    if (start.code === 0) {
      return undefined;
    }
    last = describeFailure(start);
    if (attempt < START_TRIES) {
      await deps.clock.sleep(START_PAUSE_MS);
    }
  }
  return `herdr agent start failed after ${START_TRIES} tries: ${last}`;
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
