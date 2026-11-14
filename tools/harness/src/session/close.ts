import type { CommandContext } from "../runtime/index.js";
import { removeMergedWorktree, type Removal } from "./close-worktree.js";
import { describeFailure, equalize } from "./equalize.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { closeHint } from "./worktree.js";

const NOT_IN_HERDR =
  "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from the Herdr pane that spawned the session.";

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

/** Removes the session's worktree and branch when --remove-worktree asked; a session without one has nothing to remove. */
async function removeWorktree(
  { deps }: CommandContext,
  record: SessionRecord,
): Promise<Removal> {
  return record.worktree === undefined
    ? {
        removed: false,
        reason: `Session ${record.name} has no worktree, so there is none to remove.`,
      }
    : await removeMergedWorktree(deps.runner, record.worktree, deps.cwd);
}

/** What the closing line says after the pane: the removal's message, or the hint when none was asked for. */
function detailOf(
  removal: Removal | undefined,
  hint: string | undefined,
): string | undefined {
  if (removal === undefined) {
    return hint;
  }
  return removal.removed ? removal.message : undefined;
}

/** Marks the session closed, rebalances the column, removes the worktree when asked, and reports. */
async function finishClose(
  context: CommandContext,
  registry: SessionRegistry,
  record: SessionRecord,
  callerPane: string,
): Promise<number> {
  const { json, deps } = context;
  const { name } = record;
  const asked = context.options["remove-worktree"] === true;
  const removal = asked ? await removeWorktree(context, record) : undefined;
  await registry.write({ ...record, closedAt: deps.clock.now().toISOString() });
  const equalized = await equalize(deps.runner, callerPane);
  const note =
    equalized.status === "failed"
      ? `Closed, but equalizing failed: ${equalized.reason}`
      : undefined;
  if (note !== undefined) {
    deps.stderr(`${note}\n`);
  }
  const hint =
    asked || record.worktree === undefined
      ? undefined
      : closeHint(record.worktree);
  const detail = detailOf(removal, hint);
  const kept = removal !== undefined && !removal.removed;
  if (kept) {
    deps.stderr(`${removal.reason}\n`);
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ name, paneId: record.paneId, closed: true, equalize: equalized, ...(hint === undefined ? {} : { hint }), ...(removal === undefined ? {} : { removal }) })}\n`
      : `Closed ${name} (pane ${record.paneId}).${detail === undefined ? "" : ` ${detail}`}\n`,
  );
  return kept ? FAILED : 0;
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
  const nameError = sessionNameError(name);
  if (nameError !== undefined) {
    return fail(deps, json, USAGE_ERROR, nameError);
  }
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1" || !callerPane) {
    return fail(deps, json, FAILED, NOT_IN_HERDR);
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
  return await finishClose(context, registry, record, callerPane);
}
