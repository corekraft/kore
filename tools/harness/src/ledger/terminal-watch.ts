import type { Status, Terminal } from "../terminal/index.js";
import type { EventInput } from "./schema.js";
import type { Kind, TerminalStatus } from "./schema-kinds.js";

/** The label that marks a terminal the watch records: a session's name, as spawn sets it. */
const SESSION_LABEL = "kore-session";

/** The kind each status is recorded as (plan 16, Step 4 (e)). A stall is a blocked or error event, not a timing guess. */
const KIND_OF: Record<TerminalStatus, Kind> = {
  working: "pane.busy",
  idle: "pane.waiting",
  done: "pane.waiting",
  blocked: "pane.stalled",
  error: "pane.stalled",
  finished: "pane.finished",
  unreported: "pane.spawned",
};

/** A terminal's reading: its status and turn. With the terminal id it is the key the watch records once per change. */
export interface Reading {
  status: TerminalStatus;
  turn: number;
}

/** A finished terminal reads as finished, whatever status it last reported; a live one with no status reads as unreported. */
function readingOf(terminal: Terminal): Reading {
  const status: Status | "finished" | "unreported" =
    terminal.state === "finished"
      ? "finished"
      : (terminal.status ?? "unreported");
  return { status, turn: terminal.turn ?? 0 };
}

/** The last reading the ledger holds for each terminal, read from its terminal events in ledger order. */
export function lastReadings(
  events: readonly EventInput[],
): Map<string, Reading> {
  const last = new Map<string, Reading>();
  for (const event of events) {
    if (
      event.source === "terminal" &&
      event.pane !== undefined &&
      event.status !== undefined &&
      event.turn !== undefined
    ) {
      last.set(event.pane, { status: event.status, turn: event.turn });
    }
  }
  return last;
}

/**
 * The events a pass over the listed terminals appends: one per terminal whose reading differs from the last
 * recorded one, so a duplicate, or a terminal listed twice, is recorded once. `last` is the reading of each
 * terminal after the pass, for the next pass to compare with. Terminals without the session label are not the
 * watch's, and are never recorded.
 */
export function planTerminals(
  terminals: readonly Terminal[],
  last: ReadonlyMap<string, Reading>,
  occurredAt: string,
): { events: EventInput[]; last: Map<string, Reading> } {
  const next = new Map(last);
  const events: EventInput[] = [];
  for (const terminal of terminals) {
    const session = terminal.labels[SESSION_LABEL];
    if (session === undefined) {
      continue;
    }
    const reading = readingOf(terminal);
    const seen = next.get(terminal.id);
    if (
      seen !== undefined &&
      seen.status === reading.status &&
      seen.turn === reading.turn
    ) {
      continue;
    }
    next.set(terminal.id, reading);
    events.push({
      source: "terminal",
      kind: KIND_OF[reading.status],
      occurredAt,
      pane: terminal.id,
      session,
      status: reading.status,
      turn: reading.turn,
    });
  }
  return { events, last: next };
}
