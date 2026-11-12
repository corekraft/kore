import type { CliDeps, CommandContext } from "../runtime/index.js";
import { launch } from "./launch.js";
import {
  describeFailure,
  equalize,
  readLayout,
  spawnedColumn,
} from "./equalize.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry } from "./registry.js";
import { finish } from "./spawn-finish.js";
import { parseTimeout } from "./wait.js";

const REQUIRED = ["role", "model", "effort", "name", "brief"] as const;

type Values = Record<(typeof REQUIRED)[number], string>;
type Checked =
  | { values: Values; callerPane: string; timeoutMs: number }
  | { error: string; code: number };

function paneIdOf(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: { pane?: { pane_id?: unknown } };
    };
    const id = parsed.result?.pane?.pane_id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Everything that can be refused is refused here, before any herdr call. */
function check({ deps, options }: CommandContext): Checked {
  const usage = (error: string): Checked => ({ error, code: USAGE_ERROR });
  const missing = REQUIRED.find((flag) => typeof options[flag] !== "string");
  if (missing !== undefined) {
    return usage(`Missing --${missing}.`);
  }
  const given = options as Values;
  const nameError = sessionNameError(given.name);
  if (nameError !== undefined) {
    return usage(nameError);
  }
  const timeoutMs = parseTimeout(options.timeout);
  if (typeof timeoutMs !== "number") {
    return usage(timeoutMs.error);
  }
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1") {
    return {
      error:
        "Not inside Herdr (HERDR_ENV is not 1). Run this from a Herdr pane; no session was started.",
      code: FAILED,
    };
  }
  if (callerPane === undefined || callerPane === "") {
    return {
      error:
        "HERDR_PANE_ID is not set, so the session cannot broadcast back. Run this from a Herdr pane.",
      code: FAILED,
    };
  }
  return { values: given, callerPane, timeoutMs };
}

/** Splits right for the first spawned pane, else down on the bottom-most one. */
async function splitPane(
  deps: CliDeps,
  callerPane: string,
): Promise<string | { error: string }> {
  const read = await readLayout(deps.runner, callerPane);
  if ("error" in read) {
    return { error: `${read.error}. No pane was split.` };
  }
  const last = spawnedColumn(read.layout, callerPane).at(-1);
  const where =
    last === undefined
      ? ["--current", "--direction", "right"]
      : [last.pane_id, "--direction", "down"];
  const split = await deps.runner.run("herdr", [
    "pane",
    "split",
    ...where,
    "--cwd",
    deps.cwd,
    "--no-focus",
  ]);
  if (split.code !== 0) {
    return { error: `herdr pane split failed: ${describeFailure(split)}` };
  }
  const paneId = paneIdOf(split.stdout);
  return (
    paneId ?? {
      error: `herdr pane split did not return a pane id (.result.pane.pane_id): ${split.stdout.trim()}`,
    }
  );
}

/** An error when the name is taken or cannot be checked; undefined when it is free. */
async function nameTakenError(
  deps: CliDeps,
  name: string,
): Promise<string | undefined> {
  const found = await deps.runner.run("herdr", ["agent", "get", name]);
  if (found.code === 0) {
    return `A session named ${name} already exists; pick another name or close that session first. No pane was split.`;
  }
  if (`${found.stdout}${found.stderr}`.includes("agent_not_found")) {
    return undefined;
  }
  return `herdr agent get failed: ${describeFailure(found)}. No pane was split.`;
}

/** `session spawn`: place, name and brief a Claude session in a new Herdr pane, then wait for its result unless --no-wait. */
export async function spawn(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  const checked = check(context);
  if ("error" in checked) {
    return fail(deps, json, checked.code, checked.error);
  }
  const { name, model, role, effort } = checked.values;
  const { callerPane } = checked;
  const registry = await SessionRegistry.open(deps);

  const taken = await nameTakenError(deps, name);
  if (taken !== undefined) {
    return fail(deps, json, FAILED, taken);
  }
  const paneId = await splitPane(deps, callerPane);
  if (typeof paneId !== "string") {
    return fail(deps, json, FAILED, paneId.error);
  }
  const leftOpen = `The pane ${paneId} was left open; close it with \`herdr pane close ${paneId}\`.`;
  const equalized = await equalize(deps.runner, callerPane);
  if (equalized.status === "failed") {
    return fail(deps, json, FAILED, `${equalized.reason}. ${leftOpen}`);
  }

  const modelCheck = await launch(deps, {
    ...checked.values,
    paneId,
    callerPane,
    leftOpen,
  });
  if ("error" in modelCheck) {
    return fail(deps, json, FAILED, modelCheck.error);
  }
  return await finish(context, {
    registry,
    modelCheck,
    record: {
      name,
      paneId,
      callerPane,
      model,
      role,
      effort,
      createdAt: deps.clock.now().toISOString(),
    },
    timeoutMs: checked.timeoutMs,
  });
}
