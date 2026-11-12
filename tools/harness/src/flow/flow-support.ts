import type { Kind, LedgerEvent, Source } from "../ledger/index.js";

export const T0 = Date.parse("2026-01-02T00:00:00.000Z");

let counter = 0;

function sourceOf(kind: Kind): Source {
  if (kind.startsWith("pane.")) {
    return "herdr";
  }
  return kind.startsWith("issue.") || kind.startsWith("pr.")
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

/** One idea that finished: opened, approved, written, merged, closed. */
export function finishedIdea(
  n: number,
  waits: { approval: number; merge?: number },
  base = 0,
): LedgerEvent[] {
  const idea = `#${n}`;
  const approved = base + waits.approval;
  const merged = approved + 10 + (waits.merge ?? 10);
  return [
    at(base, "issue.opened", { number: n }),
    at(approved, "issue.labelled", { number: n, label: "ready-for-agent" }),
    at(approved + 1, "pane.spawned", { pane: `w${n}-writer`, idea }),
    at(approved + 6, "pane.closed", { pane: `w${n}-writer`, idea }),
    at(approved + 7, "pr.opened", { number: 100 + n, idea }),
    at(merged, "pr.merged", { number: 100 + n, idea }),
    at(merged + 1, "issue.closed", { number: n }),
  ];
}
