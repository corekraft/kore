import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

/** A ledger event an hc session tool writes: the kind, the terminal it names, and the session it names. */
export interface TerminalEvent {
  kind: "session.send" | "pane.closed";
  pane: string;
  agent: string;
  senderRole?: string;
  senderName?: string;
}

/**
 * Appends one ledger event written from an hc terminal (source terminal). Returns why it was not recorded,
 * or undefined once it is. Only a ledger write failure is expected; any other error is rethrown.
 */
export async function recordTerminalEvent(
  deps: CliDeps,
  event: TerminalEvent,
): Promise<string | undefined> {
  const main = await mainRoot(deps);
  if (main === undefined) {
    return "cannot find the main checkout to keep the ledger in";
  }
  try {
    const written = await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record({
      source: "terminal",
      kind: event.kind,
      occurredAt: deps.clock.now().toISOString(),
      pane: event.pane,
      agent: event.agent,
      ...(event.senderRole === undefined
        ? {}
        : { senderRole: event.senderRole }),
      ...(event.senderName === undefined
        ? {}
        : { senderName: event.senderName }),
    });
    return written.ok ? undefined : written.message;
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code !== "string") {
      throw error;
    }
    return (error as Error).message;
  }
}
