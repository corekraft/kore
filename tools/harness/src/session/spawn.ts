import type { CliDeps, CommandContext } from "../runtime/index.js";
import { launch } from "./launch.js";
import {
  describeFailure,
  equalize,
  readLayout,
  spawnedColumn,
} from "./equalize.js";
import { FAILED, fail } from "./output.js";
import { check } from "./spawn-check.js";
import { SessionRegistry } from "./registry.js";
import { finish } from "./spawn-finish.js";
import { place } from "./worktree.js";

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

/** Splits right for the first spawned pane, else down on the bottom-most one. */
async function splitPane(
  deps: CliDeps,
  callerPane: string,
  cwd: string,
  env: Record<string, string>,
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
    cwd,
    "--no-focus",
    // Stamped by the harness, not typed by the agent, so the ledger can attribute its events.
    ...Object.entries(env).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]),
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
  const checked = await check(context);
  if ("error" in checked) {
    return fail(deps, json, checked.code, checked.error);
  }
  const { name, model, role, effort } = checked.values;
  const { callerPane } = checked;
  const registry = await SessionRegistry.open(deps);

  const taken =
    (await registry.unavailable(name)) ?? (await nameTakenError(deps, name));
  if (taken !== undefined) {
    return fail(deps, json, FAILED, taken);
  }
  const placed = await place(deps, context.options, name);
  if ("error" in placed) {
    return fail(deps, json, FAILED, placed.error);
  }
  const paneId = await splitPane(deps, callerPane, placed.cwd, {
    KORE_AGENT: name,
    ...(checked.idea === undefined ? {} : { KORE_IDEA: checked.idea }),
  });
  if (typeof paneId !== "string") {
    return fail(deps, json, FAILED, `${paneId.error}${placed.left}`);
  }
  const leftOpen = `The pane ${paneId} was left open; close it with \`herdr pane close ${paneId}\`.${placed.left}`;
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
      ...(placed.worktree === undefined ? {} : { worktree: placed.worktree }),
      createdAt: deps.clock.now().toISOString(),
    },
    timeoutMs: checked.timeoutMs,
  });
}
