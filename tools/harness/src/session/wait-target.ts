// The session side of `harness wait --session <name>` (ADR 0123): opens a spawned session as a
// wait target, and settles it once through the same report read `session wait` uses, so its outcome
// is recorded exactly as `session wait` records it. The command never reads a terminal itself.
// Docs: infra/plans/3-agent-harness.md

import type { CliDeps } from "../runtime/index.js";
import { terminalsFor } from "./backend.js";
import { sessionNameError } from "./names.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { readSettledOnce } from "./wait-hc.js";

/** A spawned session `harness wait` watches: its record, and the registry its outcome is written to. */
export interface SessionWaitTarget {
  readonly name: string;
  readonly record: SessionRecord;
  readonly registry: SessionRegistry;
}

/** A target when the name is a spawned session; otherwise a usage refusal for a bad name, or a failure for one never spawned. */
export type OpenedTarget =
  { target: SessionWaitTarget } | { usage: string } | { error: string };

/** Opens the named session as a wait target, refusing a name the session domain rejects or one this tool never spawned. */
export async function openSessionTarget(
  deps: CliDeps,
  name: string,
): Promise<OpenedTarget> {
  const nameError = sessionNameError(name);
  if (nameError !== undefined) {
    return { usage: nameError };
  }
  const registry = await SessionRegistry.open(deps);
  const record = await registry.read(name);
  if (record === undefined) {
    return {
      error: `No session named ${name} was spawned by this tool; start it with \`session spawn\`.`,
    };
  }
  return { target: { name, record, registry } };
}

/**
 * Reads the target's report once: "pending" while it has settled on nothing, the outcome word once it has
 * (recorded by session wait's read), or an error when its terminal cannot be read.
 */
export async function settleSessionTarget(
  deps: CliDeps,
  target: SessionWaitTarget,
): Promise<"pending" | { outcome: "done" | "blocked" } | { error: string }> {
  const settled = await readSettledOnce(
    deps,
    terminalsFor(deps),
    target.registry,
    target.record,
  );
  if (settled === undefined) {
    return "pending";
  }
  if ("error" in settled) {
    return settled;
  }
  return { outcome: settled.outcome };
}
