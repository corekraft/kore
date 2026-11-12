import type { LedgerEvent } from "../ledger/index.js";
import { uncovered, type Span } from "./intervals.js";

export type ToilKind = "starting" | "stopping" | "waiting" | "retrying";

/** What one spawn-to-close life of an actor has done so far. */
export interface Life {
  /** The life began at a spawn or session start, so its first tool ends a startup. */
  began: boolean;
  lastToolAt: number | undefined;
  failed: { tool: string | undefined; at: number } | undefined;
  /** Spans the pane waited on a person; toil gaps leave them out, so kinds never overlap. */
  waits: Span[];
}

export const newLife = (first: LedgerEvent): Life => ({
  began: first.kind === "pane.spawned" || first.kind === "session.start",
  lastToolAt: undefined,
  failed: undefined,
  waits: [],
});

/** Charges the toil one event closes: starting, stopping, or a retry gap. */
export function chargeToil(
  add: (kind: ToilKind, ms: number) => void,
  event: LedgerEvent,
  at: number,
  start: number,
  life: Life,
) {
  const gap = (from: number, to: number) => uncovered([from, to], life.waits);
  const isTool = event.kind === "tool.start" || event.kind === "tool.end";
  if (isTool && life.lastToolAt === undefined && life.began) {
    add("starting", gap(start, at));
  }
  if (event.kind === "tool.start") {
    if (life.failed !== undefined && life.failed.tool === event.tool) {
      add("retrying", gap(life.failed.at, at));
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
    add("stopping", gap(life.lastToolAt, at));
  }
}
