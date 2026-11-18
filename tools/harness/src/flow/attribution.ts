import type { LedgerEvent } from "../ledger/index.js";

/** The value a pull request's link writes when the pull request serves no idea (ADR 0126). */
const NO_IDEA = "none";

/**
 * The idea an event names, or undefined. A pull request's link that names `none` names no idea:
 * `none` is never an idea in the flow, so its writing stays unattributed (ADR 0126).
 */
export function namedIdea(event: LedgerEvent): string | undefined {
  if (event.kind === "pr.linked" && event.idea === NO_IDEA) {
    return undefined;
  }
  return event.idea;
}

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
    // A link names the idea of its own pull request only: it seeds no pane or session, so the
    // writer's other events keep the reading they had and idea 0012's measure moves by the
    // link alone (#1093). The writing join reads the link directly (cost-waiting-writing.ts).
    const idea = event.kind === "pr.linked" ? undefined : namedIdea(event);
    if (idea !== undefined) {
      for (const actor of actors(event)) {
        byActor.set(actor, idea);
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
    result.set(event.id, namedIdea(event) ?? own ?? inherited);
  }
  return result;
}
