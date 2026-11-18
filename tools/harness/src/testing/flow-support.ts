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

/**
 * A token.split reading of a roleless main session on one model, `seconds` after T0: its input
 * tokens at the low prompt step, every other count zero.
 */
export function mainSplit(
  seconds: number,
  session: string,
  model: string,
  lowInput: number,
): LedgerEvent {
  return at(seconds, "token.split", {
    session,
    model,
    firstPrompt: 1000,
    largestPrompt: 1000,
    lowRequests: 1,
    lowInput,
    lowCacheWrite5m: 0,
    lowCacheWrite1h: 0,
    lowCacheRead: 0,
    lowOutput: 0,
    highRequests: 0,
    highInput: 0,
    highCacheWrite5m: 0,
    highCacheWrite1h: 0,
    highCacheRead: 0,
    highOutput: 0,
  });
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
