// Routes a session tool to the backend its record names. The record decides, never a flag:
// a record with no backend is herdr, so every record written before the field keeps its path.
import type { Terminals } from "../terminal/index.js";
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
