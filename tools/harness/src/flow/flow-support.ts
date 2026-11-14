// Fixtures the flow domain's unit specs share: a stored ledger event at a fixed
// time. Kept here so a spec does not load the whole testing barrel (test budget).
import type { Kind, LedgerEvent, Source } from "../ledger/index.js";

export const T0 = Date.parse("2026-01-02T00:00:00.000Z");

let counter = 0;

function sourceOf(kind: Kind): Source {
  if (kind.startsWith("pane.")) {
    return "herdr";
  }
  return kind.startsWith("issue.") ||
    kind.startsWith("pr.") ||
    kind.startsWith("ci.") ||
    kind.startsWith("owner.")
    ? "github"
    : "claude";
}

/** A stored ledger event `seconds` after T0; fields default to a claude event. */
export function at(
  seconds: number,
  kind: Kind,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent {
  counter += 1;
  const occurredAt = new Date(T0 + seconds * 1000).toISOString();
  return {
    schema: 1,
    id: `e${counter}`,
    source: sourceOf(kind),
    kind,
    occurredAt,
    recordedAt: occurredAt,
    ...fields,
  };
}
