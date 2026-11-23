import { join } from "node:path";
import {
  DEFAULT_LEDGER,
  Ledger,
  type Kind,
  isName,
  type LedgerEvent,
} from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { hcTerminalId, sessionIdentity } from "./guard-identity.js";

/** What a ledger event takes from the host's payload. */
export interface EventCall {
  tool_name?: unknown;
  session_id?: unknown;
}

const ledgerRoots = new WeakMap<CliDeps, Promise<string | undefined>>();

/** The ledger root, asked once per run: a block records twice and git is the slow part. */
function ledgerRoot(deps: CliDeps): Promise<string | undefined> {
  let root = ledgerRoots.get(deps);
  if (root === undefined) {
    root = mainRoot(deps);
    ledgerRoots.set(deps, root);
  }
  return root;
}

async function holds(ledger: Ledger, kind: Kind, id: string): Promise<boolean> {
  const { events } = await ledger.list({ kind });
  return events.some((e) => e.id === id);
}

/** The session and idea an event names: only the record hc confirmed, never the environment. Outside an hc terminal, none. */
async function identityOf(deps: CliDeps): Promise<Partial<LedgerEvent>> {
  if (hcTerminalId(deps) === undefined) {
    return {};
  }
  const identity = await sessionIdentity(deps);
  if (identity?.checked !== true || !isName(identity.name)) {
    return {};
  }
  const idea = identity.idea;
  return {
    agent: identity.name,
    ...(idea !== undefined && isName(idea) ? { idea } : {}),
  };
}

/**
 * Appends one Claude event to the ledger. Best effort by contract: a missing
 * ledger root or a rejected event never changes a hook's verdict or output.
 * An `extra.id` makes the event unique: the ledger already holding that id
 * of this kind records nothing.
 */
export async function recordEvent(
  deps: CliDeps,
  kind: Kind,
  call: EventCall,
  outcome?: "success" | "failure",
  extra: Partial<LedgerEvent> = {},
): Promise<void> {
  try {
    const session = call.session_id;
    if (typeof session !== "string" || session === "") {
      return;
    }
    const main = await ledgerRoot(deps);
    if (main === undefined) {
      return;
    }
    const event: Partial<LedgerEvent> = {
      source: "claude",
      kind,
      occurredAt: deps.clock.now().toISOString(),
      session,
      ...(await identityOf(deps)),
      ...(kind.startsWith("tool.") && typeof call.tool_name === "string"
        ? { tool: call.tool_name }
        : {}),
      ...(outcome === undefined ? {} : { outcome }),
      ...extra,
    };
    const ledger = new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    );
    if (extra.id !== undefined && (await holds(ledger, kind, extra.id))) {
      return;
    }
    await ledger.record(event);
  } catch {
    // Recording is best effort by contract.
  }
}
