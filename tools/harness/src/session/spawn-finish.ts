import type { TierOrigin } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";
import type { ModelCheck } from "./models.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import {
  noteUnstamped,
  recordIdeaLabels,
  recordLaunch,
} from "./spawn-record.js";
import { recordHostSample } from "./spawn-sample.js";
import { formatWait, waitForResult } from "./wait.js";

interface Finish {
  registry: SessionRegistry;
  record: SessionRecord;
  modelCheck: ModelCheck;
  timeoutMs: number;
  /** Where the tier came from; absent leaves the launch event with no tier source. */
  tier?: TierOrigin;
  /** The stage derived from the role; absent leaves the launch event unstamped. */
  stage?: string;
  /** Set when the spawn names no idea: warns and records it, and the spawn still starts. */
  unstamped?: { reason?: string };
  /** The idea the spawn names, as `#n`; a writer's launch with one records its issue's labels. */
  idea?: string;
}

/** Records the spawned session, then reports it or, without --no-wait, waits for its result. */
export async function finish(
  { json, deps, options }: CommandContext,
  {
    registry,
    record,
    modelCheck,
    timeoutMs,
    tier,
    stage,
    unstamped,
    idea,
  }: Finish,
): Promise<number> {
  const { name, paneId, callerPane, model, role, effort, worktree } = record;
  const extra = worktree === undefined ? {} : { worktree };
  await registry.create(record);
  await recordLaunch(deps, record, tier, stage);
  if (idea !== undefined && role === "writer") {
    await recordIdeaLabels(deps, { name, createdAt: record.createdAt }, idea);
  }
  if (unstamped !== undefined) {
    await noteUnstamped(
      deps,
      { name, paneId, role, createdAt: record.createdAt },
      unstamped,
    );
  }
  await recordHostSample(deps, { pane: paneId, name });
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
