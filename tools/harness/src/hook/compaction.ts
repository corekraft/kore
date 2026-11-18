// The compaction counter (#1037, spec #1027): a session start with the compact matcher
// appends one numbers-only session.compacted reading. The stop hook does not see
// compactions, so the count cannot come from it. Each compaction leaves one compact summary
// line in the transcript, so the number of those lines names the compaction: a replay of
// the same start record names the same one, and the ledger writer keeps one reading per id.

import type { CliDeps } from "../runtime/index.js";
import { recordEvent, type EventCall } from "./ledger-event.js";

/** What the count takes from the host's SessionStart payload. */
export interface CompactCall extends EventCall {
  transcript_path?: unknown;
}

/** The compact summary lines a transcript holds: one per compaction. A torn or foreign line counts as none. */
export function compactionsIn(transcript: string): number {
  let count = 0;
  for (const raw of transcript.split("\n")) {
    try {
      const event = JSON.parse(raw) as { isCompactSummary?: unknown } | null;
      if (event !== null && event.isCompactSummary === true) {
        count += 1;
      }
    } catch {
      // A line that is not JSON is no compact summary.
    }
  }
  return count;
}

/**
 * Appends this compaction's reading: the session's name and the compaction's number, never
 * text. Best effort by contract: a transcript that cannot be read, or that holds no compact
 * summary yet, records nothing rather than a number it cannot name.
 */
export async function recordCompaction(
  deps: CliDeps,
  call: CompactCall,
): Promise<void> {
  const { session_id: session, transcript_path: path } = call;
  if (typeof session !== "string" || typeof path !== "string") {
    return;
  }
  let compaction: number;
  try {
    compaction = compactionsIn(await deps.fs.readFile(path));
  } catch {
    return;
  }
  if (compaction === 0) {
    return;
  }
  await recordEvent(deps, "session.compacted", call, undefined, {
    id: `compaction:${session}:${compaction}`,
    compaction,
  });
}
