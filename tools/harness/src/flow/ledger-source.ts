// Splits the flow report's pane readers by ledger source (#1782). A pane or session is
// read as terminal when the ledger records any terminal-source event for it, and as herdr
// otherwise: every line written before the terminal source is herdr's. An event that names
// neither a pane nor a session belongs to no source and reads in every view.

import type { LedgerEvent } from "../ledger/index.js";

export type FlowSource = "herdr" | "terminal";

export interface SourceSplit {
  /** Whether the ledger holds any terminal-source event; when false every reading is the herdr reading. */
  terminal: boolean;
  /** The source an event is read under, or undefined for an event that names neither a pane nor a session. */
  of(event: LedgerEvent): FlowSource | undefined;
  /** The events one source reads: its own, plus the events that belong to no source. */
  view(events: readonly LedgerEvent[], source: FlowSource): LedgerEvent[];
}

/** Reads each event's source from the pane or session it names, over the whole ledger. */
export function sourceSplit(events: readonly LedgerEvent[]): SourceSplit {
  const terminalPanes = new Set<string>();
  const terminalSessions = new Set<string>();
  let terminal = false;
  for (const event of events) {
    if (event.source !== "terminal") {
      continue;
    }
    terminal = true;
    if (event.pane !== undefined) {
      terminalPanes.add(event.pane);
    }
    if (event.session !== undefined) {
      terminalSessions.add(event.session);
    }
  }
  for (const event of events) {
    if (
      event.session !== undefined &&
      event.pane !== undefined &&
      terminalPanes.has(event.pane)
    ) {
      terminalSessions.add(event.session);
    }
  }
  const of = (event: LedgerEvent): FlowSource | undefined => {
    if (event.pane !== undefined) {
      return terminalPanes.has(event.pane) ? "terminal" : "herdr";
    }
    if (event.session !== undefined) {
      return terminalSessions.has(event.session) ? "terminal" : "herdr";
    }
    return undefined;
  };
  return {
    terminal,
    of,
    view: (list, source) =>
      list.filter((event) => {
        const origin = of(event);
        return origin === undefined || origin === source;
      }),
  };
}

/** The ideas one source reads, in the map's order: each idea reads under its own source. */
export function sourcedIdeas<T extends readonly LedgerEvent[]>(
  byIdea: ReadonlyMap<string, T>,
  split: SourceSplit,
  source: FlowSource,
): Map<string, T> {
  return new Map(
    [...byIdea].filter(([, own]) => ideaSource(own, split) === source),
  );
}

/** An idea reads under the source of its earliest pane or session event, herdr when it has none. */
export function ideaSource(
  own: readonly LedgerEvent[],
  split: SourceSplit,
): FlowSource {
  let first: { at: number; source: FlowSource } | undefined;
  for (const event of own) {
    const source = split.of(event);
    if (source === undefined) {
      continue;
    }
    const at = Date.parse(event.occurredAt);
    if (first === undefined || at < first.at) {
      first = { at, source };
    }
  }
  return first?.source ?? "herdr";
}
