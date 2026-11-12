import type { CommandContext } from "../runtime/index.js";
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

/** Records the spawned session, then reports it or, without --no-wait, waits for its result. */
export async function finish(
  { json, deps, options }: CommandContext,
  { registry, record, modelCheck, timeoutMs }: Finish,
): Promise<number> {
  const { name, paneId, callerPane, model, role, effort } = record;
  await registry.create(record);
  const verdict =
    modelCheck.status === "verified"
      ? "model verified"
      : `model unverified: ${modelCheck.reason}`;
  if (options["no-wait"] === true) {
    deps.stdout(
      json
        ? `${JSON.stringify({ name, paneId, model, role, effort, modelCheck })}\n`
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
      ? `${JSON.stringify({ ...result, role, effort, modelCheck })}\n`
      : `${formatWait(result).trimEnd()} (${verdict}).\n`,
  );
  return 0;
}
