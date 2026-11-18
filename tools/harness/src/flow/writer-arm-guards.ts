// The guards an arm reads beside its cost (#1012, spec #998): the blocked share of its writer
// sessions, its send-backs and its owner minutes, each per merged change where that applies. Each is
// null, never zero, where nothing can be read.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { sendBacksInRange } from "./send-back-categories.js";
import { ownerMinutesIn } from "./writer-tier-figures.js";
import { latestResults } from "./writer-usage.js";

/** An arm's guards over its merged changes in the span. */
export interface ArmGuards {
  /** Blocked writer sessions over the arm's writer sessions with a result in the span; null with none. */
  blockedShare: number | null;
  /** Send-backs for the arm's merged changes over those changes; null with none. */
  sendBacksPerMergedChange: number | null;
  /** Owner minutes on the arm's merged changes over those changes; null with none. */
  ownerMinutesPerMergedChange: number | null;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * The guards of one arm: `numbers` are its merged changes' pull requests and `writers` the writer
 * sessions linked to them. A send-back counts when it names one of the arm's changes.
 */
export function armGuards(
  events: LedgerEvent[],
  span: Span,
  numbers: number[],
  writers: string[],
): ArmGuards {
  const n = numbers.length;
  const numberSet = new Set(numbers);
  const results = latestResults(events, span[1]);
  const finished = writers.filter((agent) => results.has(agent));
  const blocked = finished.filter(
    (agent) => results.get(agent)?.result === "blocked",
  );
  const sendBacks = sendBacksInRange(
    events.filter(
      (e) =>
        e.kind === "send-back" &&
        e.number !== undefined &&
        numberSet.has(e.number),
    ),
    span,
  );
  const minutes = ownerMinutesIn(events, span, numbers);
  return {
    blockedShare:
      finished.length === 0 ? null : round(blocked.length / finished.length),
    sendBacksPerMergedChange: n === 0 ? null : round(sendBacks / n),
    ownerMinutesPerMergedChange: n === 0 ? null : round(minutes / n),
  };
}
