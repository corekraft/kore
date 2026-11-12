import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  mainRoot,
  type CliDeps,
  type CommandContext,
} from "../runtime/index.js";
import type { ModelCheck } from "./models.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import { formatWait, waitForResult } from "./wait.js";

interface Finish {
  registry: SessionRegistry;
  record: SessionRecord;
  modelCheck: ModelCheck;
  timeoutMs: number;
}

/** Appends a session.launch event for the session. Best effort: a ledger problem never fails the spawn. */
async function recordLaunch(deps: CliDeps, record: SessionRecord) {
  try {
    const main = await mainRoot(deps);
    if (main === undefined) {
      return;
    }
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record({
      source: "herdr",
      kind: "session.launch",
      occurredAt: record.createdAt,
      pane: record.paneId,
      agent: record.name,
      role: record.role,
      tier: record.model,
    });
  } catch {
    // The ledger is a measurement; it never gates a spawn.
  }
}

/** Records the spawned session, then reports it or, without --no-wait, waits for its result. */
export async function finish(
  { json, deps, options }: CommandContext,
  { registry, record, modelCheck, timeoutMs }: Finish,
): Promise<number> {
  const { name, paneId, callerPane, model, role, effort, worktree } = record;
  const extra = worktree === undefined ? {} : { worktree };
  await registry.create(record);
  await recordLaunch(deps, record);
  const verdict =
    modelCheck.status === "verified"
      ? "model verified"
      : `model unverified: ${modelCheck.reason}`;
  if (options["no-wait"] === true) {
    deps.stdout(
      json
        ? `${JSON.stringify({ name, paneId, model, role, effort, ...extra, modelCheck })}\n`
        : `Spawned ${name} (${model}; ${verdict}) in pane ${paneId}; it will broadcast to ${callerPane} when it finishes. Collect its result with \`session wait ${name}\`.\n`,
    );
    return 0;
  }
  const result = await waitForResult(deps, registry, record, timeoutMs);
  if ("error" in result) {
    return fail(deps, json, FAILED, result.error);
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ ...result, role, effort, ...extra, modelCheck })}\n`
      : `${formatWait(result).trimEnd()} (${verdict}).\n`,
  );
  return 0;
}
