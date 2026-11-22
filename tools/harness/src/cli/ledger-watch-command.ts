import { followTerminals, type Ledger } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { terminalsFor } from "../session/index.js";
import * as help from "./ledger-help.js";

/** Opens the shared ledger, or says why it cannot; the ledger commands pass theirs in. */
export type OpenLedger = (
  context: CommandContext,
) => Promise<{ ledger: Ledger } | { error: string }>;

/** Refuses with the message: a JSON error with --json, else the message alone. Exit 1. */
function refuse(
  context: CommandContext,
  message: string,
  field: string,
): number {
  const { deps, json } = context;
  deps.stderr(
    json ? `${JSON.stringify({ error: message, field })}\n` : `${message}\n`,
  );
  return 1;
}

/**
 * `harness ledger watch` (plan 16, Step 4 (e)): follows hc's terminals and records each session's reading as it
 * changes. It exits 0 when hc's stream ends cleanly, and 1 with the failure on stderr otherwise.
 */
export function watchCommand(open: OpenLedger): Command {
  return {
    summary:
      "follow hc's terminals and append each session's status to the ledger as it changes, until hc's events stop",
    options: { ledger: "string" },
    help: help.watchHelp,
    async run(context) {
      const opened = await open(context);
      if ("error" in opened) {
        return refuse(context, opened.error, "ledger");
      }
      const { deps } = context;
      const ended = await followTerminals({
        ledger: opened.ledger,
        terminals: terminalsFor(deps),
        clock: deps.clock,
      });
      if (!ended.ok) {
        return refuse(context, ended.message, "terminals");
      }
      deps.stdout(
        "hc events ended: the ledger watch stopped; start it again to resume\n",
      );
      return 0;
    },
  };
}
