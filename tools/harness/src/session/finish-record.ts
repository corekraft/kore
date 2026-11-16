import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

/**
 * Records `pane.finished` when `session wait` sees a session's RESULT line (#853).
 * The event carries the pane, the session name and the outcome word only. Best
 * effort: a refused write is left out, so the flow report counts it as an undetected
 * finish, and a failure that is not an I/O error is rethrown.
 */
export async function recordFinish(
  deps: CliDeps,
  pane: string,
  name: string,
  outcome: "done" | "blocked",
): Promise<void> {
  const main = await mainRoot(deps);
  if (main === undefined) {
    return;
  }
  try {
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record({
      source: "herdr",
      kind: "pane.finished",
      occurredAt: deps.clock.now().toISOString(),
      pane,
      agent: name,
      result: outcome,
    });
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code !== "string") {
      throw error;
    }
  }
}
