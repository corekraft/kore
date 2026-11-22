import { join } from "node:path";
import type { CliDeps } from "../runtime/index.js";
import {
  hcSessionsOn,
  startLedgerWatch,
  terminalsFor,
} from "../session/index.js";

/**
 * Starts the ledger watch under this loop's terminal, before each pass (plan 16, Step 5). It does nothing while
 * the hc-sessions flag is off, or outside an hc terminal, which has no terminal to parent the watch. The watch is
 * named, so a running one is a name conflict and only a watch that ended is started again.
 */
export async function ensureLedgerWatch(
  deps: CliDeps,
  main: string,
): Promise<void> {
  if (!(await hcSessionsOn(deps))) {
    return;
  }
  const terminals = terminalsFor(deps);
  const parent = terminals.self();
  if (parent === undefined) {
    return;
  }
  await startLedgerWatch(deps, terminals, {
    bundle: join(main, "skills", "bin", "harness.mjs"),
    main,
    parent,
  });
}
