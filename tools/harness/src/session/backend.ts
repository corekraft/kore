// Routes a session tool to its record's hc terminal. A record with no terminal id never reached hc (or was written
// before the flip), so it is refused with the command that removes it, never sent anywhere else.
import {
  ProcessLineStream,
  type CliDeps,
  type LineStream,
} from "../runtime/index.js";
import {
  HcTerminals,
  type TerminalError,
  type Terminals,
} from "../terminal/index.js";
import type { SessionRecord } from "./registry.js";

export type Routed = { terminals: Terminals } | { error: string };

/**
 * Where a session tool sends work for a record: its hc terminals. A record with no terminal id is refused, and a
 * record whose start was lost before its terminal was recorded is refused with the close that clears it.
 */
export function routeSession(record: SessionRecord, hc: Terminals): Routed {
  if (record.terminal === undefined) {
    return record.starting === true
      ? {
          error: `Session ${record.name} never started a terminal, so it is blocked, not live: it was lost before its start was recorded. Run session close ${record.name} to clear it.`,
        }
      : {
          error: `Session ${record.name} has no terminal id, so it is not on hc and nothing can be sent to or read from it. Run \`harness session close --force-record ${record.name}\` to remove its record.`,
        };
  }
  return { terminals: hc };
}

/** The one place a session tool gets its hc adapter: the hc CLI over the caller's runner and environment. */
export function terminalsFor(
  deps: Pick<CliDeps, "runner" | "env">,
  lines: LineStream = new ProcessLineStream(),
): Terminals {
  return new HcTerminals({ runner: deps.runner, env: deps.env, lines });
}

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
export function hcMessage(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}
