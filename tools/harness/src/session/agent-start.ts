import type { CliDeps } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import { displayName, modelOnScreen, type ModelCheck } from "./models.js";

const BUSY_BOUND_MS = 10_000;
const MODEL_BOUND_MS = 5_000;
const RETRY_MS = 500;

/**
 * Starts the agent, retrying `agent_pane_busy` (a fresh pane's shell is not
 * ready yet) for a bounded time. An error message, or undefined on success.
 */
export async function startAgent(
  deps: CliDeps,
  args: readonly string[],
): Promise<string | undefined> {
  const deadline = deps.clock.now().getTime() + BUSY_BOUND_MS;
  for (;;) {
    const start = await deps.runner.run("herdr", args);
    if (start.code === 0) {
      return undefined;
    }
    if (!`${start.stdout}${start.stderr}`.includes("agent_pane_busy")) {
      return `herdr agent start failed: ${describeFailure(start)}`;
    }
    if (deps.clock.now().getTime() >= deadline) {
      return `herdr agent start failed: agent_pane_busy for ${BUSY_BOUND_MS / 1000} seconds; the pane's shell never became ready (${describeFailure(start)})`;
    }
    await deps.clock.sleep(RETRY_MS);
  }
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
