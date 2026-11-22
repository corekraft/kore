// Routes a session tool to the backend its record names. The record decides, never a flag:
// a record with no backend is herdr, so every record written before the field keeps its path.
import type { CliDeps } from "../runtime/index.js";
import {
  HcTerminals,
  type TerminalError,
  type Terminals,
} from "../terminal/index.js";
import type { Backend, SessionRecord } from "./registry.js";

export type Routed =
  | { backend: "herdr" }
  | { backend: "hc"; terminals: Terminals }
  | { error: string };

/** The backend a record runs on; a record with no backend predates the field and is herdr. */
function backendOf(record: SessionRecord): Backend {
  return record.backend ?? "herdr";
}

/**
 * Where a session tool sends work for a record. An hc record goes to the injected hc terminals,
 * and when there are none it is refused with a hint rather than sent to herdr.
 */
export function routeSession(
  record: SessionRecord,
  hc: Terminals | undefined,
): Routed {
  if (backendOf(record) === "herdr") {
    return { backend: "herdr" };
  }
  if (hc === undefined) {
    return {
      error: `Session ${record.name} runs on hc, but hc is not available here, so it is not routed to herdr. Install the pinned hc (plan 16, step 1), then retry.`,
    };
  }
  return { backend: "hc", terminals: hc };
}

/** The one place a session tool gets its hc adapter: the hc CLI over the caller's runner and environment. */
export function terminalsFor(deps: Pick<CliDeps, "runner" | "env">): Terminals {
  return new HcTerminals({ runner: deps.runner, env: deps.env });
}

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
export function hcMessage(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}
