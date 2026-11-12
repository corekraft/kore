import type { CommandContext } from "../runtime/index.js";
import { describeFailure, equalize } from "./equalize.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";

/** Why this caller may not close the session, or undefined when it may. */
function refuse(record: SessionRecord, callerPane: string): string | undefined {
  const { name, paneId } = record;
  if (record.closedAt !== undefined) {
    return `Session ${name} is already closed (pane ${paneId}).`;
  }
  if (record.callerPane !== callerPane) {
    return `Session ${name} was spawned from pane ${record.callerPane}, not ${callerPane}; only that pane may close it.`;
  }
  return record.result === undefined
    ? `Session ${name} has no recorded result, so pane ${paneId} stays open. Run \`session wait ${name}\` first.`
    : undefined;
}

/** `session close <name>`: close a pane only if this caller created it and its result is recorded. */
export async function close(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  const name = context.operand;
  if (name === undefined) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "Missing the session name: session close <name>.",
    );
  }
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1" || !callerPane) {
    return fail(
      deps,
      json,
      FAILED,
      "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from the Herdr pane that spawned the session.",
    );
  }
  const registry = await SessionRegistry.open(deps);
  const record = await registry.read(name);
  if (record === undefined) {
    return fail(
      deps,
      json,
      FAILED,
      `This tool did not create a session named ${name}, so it will not close one. Close it yourself with \`herdr pane close <pane-id>\` if you are sure.`,
    );
  }
  const refusal = refuse(record, callerPane);
  if (refusal !== undefined) {
    return fail(deps, json, FAILED, refusal);
  }
  const closed = await deps.runner.run("herdr", [
    "pane",
    "close",
    record.paneId,
  ]);
  if (closed.code !== 0) {
    return fail(
      deps,
      json,
      FAILED,
      `herdr pane close ${record.paneId} failed: ${describeFailure(closed)}`,
    );
  }
  await registry.write({ ...record, closedAt: deps.clock.now().toISOString() });
  const equalized = await equalize(deps.runner, callerPane);
  const note =
    equalized.status === "failed"
      ? `Closed, but equalizing failed: ${equalized.reason}`
      : undefined;
  if (note !== undefined) {
    deps.stderr(`${note}\n`);
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ name, paneId: record.paneId, closed: true, equalize: equalized })}\n`
      : `Closed ${name} (pane ${record.paneId}).\n`,
  );
  return 0;
}
