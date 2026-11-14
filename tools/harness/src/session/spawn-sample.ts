import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { liveSessionCount } from "./live-sessions.js";
import { platformUp } from "./platform-up.js";

/**
 * Appends one host-sample event for a spawned session: the host's load, memory
 * and swap, how many sessions are live, and whether the local platform is up.
 * Best effort: a failed reading or append, or an unknown live count, never
 * blocks a spawn and is never replaced by a guessed value.
 */
export async function recordHostSample(
  deps: CliDeps,
  spawned: { pane: string; name: string },
): Promise<void> {
  try {
    const main = await mainRoot(deps);
    if (main === undefined || deps.hostLoad === undefined) {
      return;
    }
    const sample = await deps.hostLoad.sample(deps.runner);
    const sessions = await liveSessionCount(deps.runner);
    if (sessions === undefined) {
      return;
    }
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record({
      source: "herdr",
      kind: "host-sample",
      occurredAt: deps.clock.now().toISOString(),
      pane: spawned.pane,
      agent: spawned.name,
      ...(Number.isFinite(sample.load) ? { load: sample.load } : {}),
      ...(sample.memory === undefined ? {} : { memory: sample.memory }),
      ...(sample.swap === undefined ? {} : { swap: sample.swap }),
      sessions,
      platform: await platformUp(deps.fs, main),
    });
  } catch {
    // The sample is a measurement; it never gates a spawn.
  }
}
