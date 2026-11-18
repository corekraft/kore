import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger, type TierOrigin } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import type { SessionRecord } from "./registry.js";
import { issueLabels } from "./spawn-labels.js";

/** Appends a session.launch event for the session. Best effort: a ledger problem never fails the spawn. */
export async function recordLaunch(
  deps: CliDeps,
  record: SessionRecord,
  tier: TierOrigin | undefined,
  stage: string | undefined,
) {
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
      ...(record.effort === undefined ? {} : { effort: record.effort }),
      ...(stage === undefined ? {} : { stage }),
      ...tier,
    });
  } catch {
    // The ledger is a measurement; it never gates a spawn.
  }
}

/**
 * Records one session.labelled event per label the idea's issue carries when the
 * session launches, keyed to the session by name, so a label changed later does not
 * move the launch between strata. A failed lookup records none. Best effort: a file
 * error never fails the spawn; any other error is a bug, and is rethrown.
 */
export async function recordIdeaLabels(
  deps: CliDeps,
  launched: { name: string; createdAt: string },
  idea: string,
): Promise<void> {
  try {
    const main = await mainRoot(deps);
    if (main === undefined) {
      return;
    }
    const names = await issueLabels(deps.runner, main, idea);
    if (names === undefined) {
      return;
    }
    const ledger = new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    );
    for (const label of names) {
      await ledger.record({
        source: "herdr",
        kind: "session.labelled",
        occurredAt: launched.createdAt,
        session: launched.name,
        label,
      });
    }
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code !== "string") {
      throw error;
    }
  }
}

/** A spawn that named no idea: its name, pane, role and launch time. */
export interface Spawned {
  name: string;
  paneId: string;
  role: string;
  createdAt: string;
}

/** The warning a required role's spawn with no idea prints: it names the missing idea and the fix, and says the session started. */
export function unstampedWarning(name: string, role: string): string {
  return `Warning: ${name} (${role}) names no idea, so its ledger events cannot be counted per idea. Add --idea <issue number> to the next spawn, or --no-idea "<reason>" if it serves no idea. The session has started.`;
}

/**
 * Warns when a required role gave no reason, then records the spawn with no idea
 * as a ledger event, carrying the --no-idea reason when there is one. Best
 * effort: a ledger problem never fails the spawn.
 */
export async function noteUnstamped(
  deps: CliDeps,
  spawned: Spawned,
  unstamped: { reason?: string },
): Promise<void> {
  if (unstamped.reason === undefined) {
    deps.stderr(`${unstampedWarning(spawned.name, spawned.role)}\n`);
  }
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
      kind: "spawn.unstamped",
      occurredAt: spawned.createdAt,
      pane: spawned.paneId,
      agent: spawned.name,
      role: spawned.role,
      ...(unstamped.reason === undefined ? {} : { label: unstamped.reason }),
    });
  } catch {
    // The ledger is a measurement; it never gates a spawn.
  }
}
