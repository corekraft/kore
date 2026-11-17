/** The ledger event a loop writes at each pass it starts: its heartbeat (idea 0007). */
export const TICK_STARTED = "tick.started";

/** The ledger event a loop writes when it ends on its own, so a stop is not read as a gap. */
export const TICK_STOPPED = "tick.stopped";

/** How long a heartbeat may stand before the tick counts as not running; a placeholder the owner may tune (idea 0007). */
export const TICK_HEARTBEAT_GAP_MS = 5 * 60 * 1000;

/** A ledger event as the heartbeat reads it: only its kind and its time matter. */
export interface TickEvent {
  kind: string;
  occurredAt: string;
}

/**
 * What the ledger says about the loop: none when it never ran, running while its
 * latest heartbeat is recent, stopped after it wrote tick.stopped, and a gap when
 * its latest heartbeat is older than the gap with no stop after it.
 */
export type TickHeartbeat =
  | { state: "none" }
  | { state: "running"; lastAt: string }
  | { state: "stopped"; at: string }
  | { state: "gap"; lastAt: string };

/** Reads the loop's state from the ledger's tick events, judged by time rather than by the order they were read in. */
export function tickHeartbeat(
  events: readonly TickEvent[],
  now: Date,
  gapMs: number = TICK_HEARTBEAT_GAP_MS,
): TickHeartbeat {
  const beats = events.filter(
    (event) => event.kind === TICK_STARTED || event.kind === TICK_STOPPED,
  );
  if (beats.length === 0) {
    return { state: "none" };
  }
  const last = beats.reduce((latest, event) =>
    Date.parse(event.occurredAt) >= Date.parse(latest.occurredAt)
      ? event
      : latest,
  );
  if (last.kind === TICK_STOPPED) {
    return { state: "stopped", at: last.occurredAt };
  }
  const age = now.getTime() - Date.parse(last.occurredAt);
  return age > gapMs
    ? { state: "gap", lastAt: last.occurredAt }
    : { state: "running", lastAt: last.occurredAt };
}
