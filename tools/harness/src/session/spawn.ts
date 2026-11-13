import type { CommandContext } from "../runtime/index.js";
import { launch } from "./launch.js";
import { FAILED, fail } from "./output.js";
import { check } from "./spawn-check.js";
import { SessionRegistry } from "./registry.js";
import { finish } from "./spawn-finish.js";
import { openPane } from "./spawn-pane.js";
import { roleToken } from "./role-token.js";

/** `session spawn`: place, name and brief a Claude session in a new Herdr pane, then wait for its result unless --no-wait. */
export async function spawn(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  const checked = await check(context);
  if ("error" in checked) {
    return fail(deps, json, checked.code, checked.error);
  }
  const { name, model, role, effort } = checked.values;
  const { callerPane } = checked;
  // Before any herdr or git call, so a missing identity leaves nothing to clean up.
  const identity = await roleToken(deps, role);
  if (identity !== undefined && "error" in identity) {
    return fail(deps, json, FAILED, identity.error);
  }
  const registry = await SessionRegistry.open(deps);
  const opened = await openPane(context, checked, registry, identity?.token);
  if ("error" in opened) {
    return fail(deps, json, FAILED, opened.error);
  }
  const { paneId, leftOpen, placed } = opened;
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
