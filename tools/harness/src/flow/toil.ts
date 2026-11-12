import type { LedgerEvent } from "../ledger/index.js";

export type ToilKind = "starting" | "stopping" | "waiting" | "retrying";

/** What one spawn-to-close life of an actor has done so far. */
export interface Life {
  lastToolAt: number | undefined;
  failed: { tool: string | undefined; at: number } | undefined;
}

export const newLife = (): Life => ({
  lastToolAt: undefined,
  failed: undefined,
});

/** Charges the toil one event closes: starting, stopping, or a retry gap. */
export function chargeToil(
  add: (kind: ToilKind, ms: number) => void,
  event: LedgerEvent,
  at: number,
  start: number,
  life: Life,
) {
  const isTool = event.kind === "tool.start" || event.kind === "tool.end";
  if (isTool && life.lastToolAt === undefined) {
    add("starting", at - start);
  }
  if (event.kind === "tool.start") {
    if (life.failed !== undefined && life.failed.tool === event.tool) {
      add("retrying", at - life.failed.at);
    }
    life.failed = undefined;
    life.lastToolAt = at;
  } else if (event.kind === "tool.end") {
    life.lastToolAt = at;
    life.failed =
      event.outcome === "failure" ? { tool: event.tool, at } : undefined;
  } else if (
    (event.kind === "pane.closed" || event.kind === "session.stop") &&
    life.lastToolAt !== undefined
  ) {
    add("stopping", at - life.lastToolAt);
  }
}
