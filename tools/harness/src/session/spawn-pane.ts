import type { CliDeps, CommandContext } from "../runtime/index.js";
import {
  describeFailure,
  equalize,
  readLayout,
  spawnedColumn,
} from "./equalize.js";
import {
  handOff,
  handoffDir,
  HANDOFF_TIMEOUT_MS,
  unreadTokenHint,
} from "./handoff.js";
import type { SessionRegistry } from "./registry.js";
import type { Checked } from "./spawn-check.js";
import { place, type Placement } from "./worktree.js";

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

export interface Opened {
  paneId: string;
  /** What to tell the caller about a pane left open when a later step fails. */
  leftOpen: string;
  placed: Placement;
  /** Adds what a failed agent start may mean for this pane. */
  explain(error: string): string;
}

/**
 * Everything between a checked request and a started agent: the name check,
 * the worktree, the pane, its layout and, for a role with an identity, its
 * token. An error message, or the open pane.
 */
export async function openPane(
  context: CommandContext,
  checked: Extract<Checked, { values: unknown }>,
  registry: SessionRegistry,
  token: string | undefined,
): Promise<Opened | { error: string }> {
  const { deps } = context;
  const { name } = checked.values;
  const taken =
    (await registry.unavailable(name)) ?? (await nameTakenError(deps, name));
  if (taken !== undefined) {
    return { error: taken };
  }
  // Resolved before anything exists, so a failure leaves nothing open.
  const dir = token === undefined ? undefined : await handoffDir(deps, name);
  const placed = await place(deps, context.options, name);
  if ("error" in placed) {
    return { error: placed.error };
  }
  const paneId = await splitPane(deps, checked.callerPane, placed.cwd, {
    KORE_AGENT: name,
    ...(checked.idea === undefined ? {} : { KORE_IDEA: checked.idea }),
  });
  if (typeof paneId !== "string") {
    return { error: `${paneId.error}${placed.left}` };
  }
  const leftOpen = `The pane ${paneId} was left open; close it with \`herdr pane close ${paneId}\`.${placed.left}`;
  const equalized = await equalize(deps.runner, checked.callerPane);
  if (equalized.status === "failed") {
    return { error: `${equalized.reason}. ${leftOpen}` };
  }
  if (token !== undefined && dir !== undefined) {
    // The pane's shell takes GH_TOKEN from a FIFO, so it is in place before claude starts.
    const handed = await handOff(deps, {
      dir,
      pane: paneId,
      token,
      timeoutMs: HANDOFF_TIMEOUT_MS,
    });
    if (handed !== undefined) {
      return { error: `${handed} ${leftOpen}` };
    }
  }
  return {
    paneId,
    leftOpen,
    placed,
    explain: token === undefined ? (error) => error : unreadTokenHint,
  };
}
