import type { CliDeps } from "../runtime/index.js";
import { checkModel, startAgent } from "./agent-start.js";
import { buildBrief } from "./brief.js";
import { describeFailure } from "./equalize.js";
import type { ModelCheck } from "./models.js";

export interface Launch {
  role: string;
  model: string;
  effort: string;
  name: string;
  brief: string;
  paneId: string;
  callerPane: string;
  leftOpen: string;
}

/** Starts claude in the pane, checks its model and delivers the brief; an error message, or the model check. */
export async function launch(
  deps: CliDeps,
  { role, model, effort, name, brief, paneId, callerPane, leftOpen }: Launch,
): Promise<ModelCheck | { error: string }> {
  const started = await startAgent(deps, [
    "agent",
    "start",
    name,
    "--kind",
    "claude",
    "--pane",
    paneId,
    "--",
    "--agent",
    role,
    "--model",
    model,
    "--effort",
    effort,
  ]);
  if (started !== undefined) {
    return { error: `${started}. ${leftOpen}` };
  }
  const checked = await checkModel(deps, name, model);
  if ("mismatch" in checked) {
    return { error: `${checked.mismatch} ${leftOpen}` };
  }
  const prompt = await deps.runner.run("herdr", [
    "agent",
    "prompt",
    name,
    buildBrief({ task: brief, name, callerPane, role }),
    "--wait",
    "--until",
    "working",
    "--timeout",
    "5000",
  ]);
  if (prompt.code === 0) {
    return checked;
  }
  // A pasted brief sometimes sits unsubmitted in the input box; one enter submits it.
  await deps.runner.run("herdr", ["agent", "send-keys", name, "enter"]);
  const retried = await deps.runner.run("herdr", [
    "agent",
    "wait",
    name,
    "--until",
    "working",
    "--timeout",
    "5000",
  ]);
  return retried.code === 0
    ? checked
    : {
        error: `herdr agent prompt failed: ${describeFailure(prompt)}; pressing enter did not start it either: ${describeFailure(retried)}. Session ${name} is running in pane ${paneId} without its brief.`,
      };
}
