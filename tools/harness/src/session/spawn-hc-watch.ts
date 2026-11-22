import type { CliDeps } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";

/** The name of the core's one ledger watch (plan 16, Grilled Decisions 8). */
export const LEDGER_WATCH = "ledger-watch";

/** Where the watch runs: the harness bundle to start, the main checkout, and the parent it is started under. */
export interface WatchPlace {
  bundle: string;
  main: string;
  parent: string;
}

/**
 * Starts the one ledger watch by name, under the session's parent, outliving it. A name conflict means the watch
 * already runs, which is no failure. Any other failure is named on stderr, and the spawn still starts.
 */
export async function startLedgerWatch(
  deps: Pick<CliDeps, "stderr">,
  terminals: Terminals,
  place: WatchPlace,
): Promise<void> {
  const started = await terminals.run({
    argv: ["node", place.bundle, "ledger", "watch"],
    name: LEDGER_WATCH,
    cwd: place.main,
    parent: place.parent,
    outliveParent: true,
  });
  if ("error" in started && started.error.kind !== "name-taken") {
    deps.stderr(`ledger watch did not start: ${hcMessage(started)}\n`);
  }
}
