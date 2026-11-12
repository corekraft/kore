// `harness hook record session-start`: records a session start in the stage
// ledger and prints nothing. A session starts on startup, clear or resume; a
// compaction continues the same session, so it is not a start. The context
// hook keeps its own matcher and output and does not record.
// Plan: infra/plans/8-harness-measurement.md#step-3-stage-event-ledger

import { hookCommand } from "./io.js";
import { recordEvent } from "./ledger-event.js";

const STARTS = new Set(["startup", "clear", "resume"]);

export const record = hookCommand(
  "record",
  "record a ledger event for the session; mode: session-start (SessionStart, no matcher)",
  async ({ deps, payload, operand }) => {
    if (typeof payload !== "object" || payload === null) {
      return {};
    }
    const call = payload as { source?: unknown; session_id?: unknown };
    if (
      operand === "session-start" &&
      typeof call.source === "string" &&
      STARTS.has(call.source)
    ) {
      await recordEvent(deps, "session.start", call);
    }
    return {};
  },
  { operand: "mode" },
);
