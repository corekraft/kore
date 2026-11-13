import { join } from "node:path";
import {
  DEFAULT_LEDGER,
  Ledger,
  type Kind,
  isName,
  type LedgerEvent,
} from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

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

/**
 * Appends one Claude event to the ledger. Best effort by contract: a missing
 * ledger root or a rejected event never changes a hook's verdict or output.
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
    const pane = deps.env["HERDR_PANE_ID"];
    // Stamped into the pane by `session spawn`; a value the ledger would refuse is left out.
    const stamp = (field: "idea" | "agent", name: string) => {
      const value = deps.env[name];
      return isName(value) ? { [field]: value } : {};
    };
    const event: Partial<LedgerEvent> = {
      source: "claude",
      kind,
      occurredAt: deps.clock.now().toISOString(),
      session,
      ...(typeof pane === "string" && pane !== "" ? { pane } : {}),
      ...stamp("idea", "KORE_IDEA"),
      ...stamp("agent", "KORE_AGENT"),
      ...(kind.startsWith("tool.") && typeof call.tool_name === "string"
        ? { tool: call.tool_name }
        : {}),
      ...(outcome === undefined ? {} : { outcome }),
      ...extra,
    };
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record(event);
  } catch {
    // Recording is best effort by contract.
  }
}
