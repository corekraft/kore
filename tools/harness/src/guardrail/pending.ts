import type { Ledger } from "../ledger/index.js";
import type { CliDeps } from "../runtime/index.js";
import { ModeHistory } from "./history.js";
import type { Inventory } from "./inventory.js";
import { REQUEST_KIND, pendingRequests, type Pending } from "./requests.js";

/** The guardrail requests still waiting for a person: the ledger's requests, resolved against the inventory's git history. */
export async function waitingRequests(
  deps: CliDeps,
  inventory: Inventory,
  ledger: Ledger,
): Promise<Map<string, Pending>> {
  const { events } = await ledger.list({ kind: REQUEST_KIND });
  const history = new ModeHistory(deps.runner, await deps.root());
  return await pendingRequests(inventory, events, (rule, to, since) =>
    history.reached(rule, to, since),
  );
}
