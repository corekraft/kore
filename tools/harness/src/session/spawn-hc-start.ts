import { join } from "node:path";
import type { CliDeps } from "../runtime/index.js";
import { buildBrief } from "./brief.js";
import { hcMessage } from "./backend.js";
import type { Admitted } from "./spawn-hc-admit.js";
import { briefOperand } from "./spawn-hc-brief.js";
import { SESSION_RECORD_VERSION, type SessionRecord } from "./registry.js";
import {
  noteUnstamped,
  recordIdeaLabels,
  recordLaunch,
} from "./spawn-record.js";

/** The exec wrapper's argv: the main checkout's bundle, the role, its model and effort, and the prompt. */
function execArgv(
  bundle: string,
  operand: string,
  role: string,
  model: string,
  effort: string,
): string[] {
  return [
    "node",
    bundle,
    "session",
    "exec",
    "--role",
    role,
    "--model",
    model,
    "--effort",
    effort,
    operand,
  ];
}

/** The record a session starts with: no terminal yet, and no pane. */
function startingRecord(admitted: Admitted, createdAt: string): SessionRecord {
  const { values } = admitted.requested;
  const { worktree } = admitted.reserved;
  const { idea } = admitted.requested;
  return {
    version: SESSION_RECORD_VERSION,
    backend: "hc",
    name: values.name,
    paneId: "",
    model: values.model,
    role: values.role,
    effort: values.effort,
    createdAt,
    ...(worktree === undefined ? {} : { worktree }),
    ...(idea === undefined ? {} : { idea }),
  };
}

/** Records what a started session launched with: its launch event, and for a writer its issue labels and any unstamped mark. */
async function recordStarted(
  deps: CliDeps,
  admitted: Admitted,
  settled: SessionRecord,
  createdAt: string,
): Promise<void> {
  const { requested } = admitted;
  const { name, role } = requested.values;
  await recordLaunch(deps, settled, requested.tier, requested.stage);
  if (requested.idea !== undefined && role === "writer") {
    await recordIdeaLabels(deps, { name, createdAt }, requested.idea);
  }
  if (requested.unstamped !== undefined) {
    await noteUnstamped(
      deps,
      { name, paneId: settled.paneId, role, createdAt },
      requested.unstamped,
    );
  }
}

/**
 * Starts an admitted session: writes its starting record first, runs the exec wrapper as one hc run under the parent,
 * then settles the record with the terminal and records the launch. A run hc refuses closes the record as blocked.
 */
export async function startSession(
  deps: CliDeps,
  admitted: Admitted,
): Promise<{ terminal: string } | { error: string }> {
  const { requested, parent, terminals, reserved, group } = admitted;
  const { values } = requested;
  const { registry, main, cwd } = reserved;
  const createdAt = deps.clock.now().toISOString();
  const base = startingRecord(admitted, createdAt);
  await registry.create({ ...base, starting: true });
  const brief = buildBrief({
    task: values.brief,
    name: values.name,
    role: values.role,
    ...(group === undefined ? {} : { group }),
  });
  const operand = await briefOperand(deps.fs, main, values.name, brief);
  const started = await terminals.run({
    argv: execArgv(
      join(main, "skills", "bin", "harness.mjs"),
      operand,
      values.role,
      values.model,
      values.effort,
    ),
    name: values.name,
    cwd,
    labels: {
      "kore-session": values.name,
      role: values.role,
      model: values.model,
      ...(group === undefined ? {} : { group }),
    },
    parent: parent.parent,
    ...(parent.delivery ? { notify: false } : {}),
  });
  if ("error" in started) {
    const message = hcMessage(started);
    // It never got a terminal, so it keeps the starting mark: a record with neither terminal nor mark is unreadable.
    await registry.write({
      ...base,
      starting: true,
      closedAt: createdAt,
      result: {
        outcome: "blocked",
        at: createdAt,
        summary: `hc did not start the session: ${message}`,
      },
    });
    return {
      error: `hc did not start ${values.name}: ${message}. Its record is closed as blocked.`,
    };
  }
  const settled: SessionRecord = {
    ...base,
    paneId: started.id,
    terminal: started.id,
  };
  await registry.write(settled);
  await recordStarted(deps, admitted, settled, createdAt);
  return { terminal: started.id };
}
