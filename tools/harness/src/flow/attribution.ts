import type { LedgerEvent } from "../ledger/index.js";

/** Idea keys: an issue's own number, else what the event, its pane or its session names. */
export function attribute(
  events: LedgerEvent[],
): Map<string, string | undefined> {
  const byActor = new Map<string, string>();
  const actors = (e: LedgerEvent) =>
    [e.pane && `pane:${e.pane}`, e.session && `session:${e.session}`].filter(
      (a): a is string => typeof a === "string",
    );
  for (const event of events) {
    if (event.idea !== undefined) {
      for (const actor of actors(event)) {
        byActor.set(actor, event.idea);
      }
    }
  }
  const result = new Map<string, string | undefined>();
  for (const event of events) {
    const own = event.kind.startsWith("issue.")
      ? `#${event.number}`
      : undefined;
    const inherited = actors(event)
      .map((a) => byActor.get(a))
      .find((i) => i !== undefined);
    result.set(event.id, event.idea ?? own ?? inherited);
  }
  return result;
}
