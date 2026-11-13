import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/**
 * Metrics whose inputs no agent writes: GitHub's own run conclusions, pull
 * requests GitHub says were merged or reverted, and the owner's own actions.
 * Each is a count or a rate over the report's range; a rate is null, never
 * zero, when nothing was measured.
 */

/** Kinds that belong to the repository, not to any idea or stage. */
export const REPOSITORY_KINDS = new Set<string>([
  "ci.main",
  "ci.nightly",
  "main.revert",
  "owner.action",
]);

/** Issue numbers that are ideas, and pull requests that close one: the only places owner time counts. */
function ideaNumbers(events: LedgerEvent[]): Set<number> {
  const numbers = new Set<number>();
  for (const e of events) {
    if (
      e.number !== undefined &&
      (e.kind === "issue.opened" ||
        (e.kind.startsWith("pr.") && e.idea !== undefined))
    ) {
      numbers.add(e.number);
    }
  }
  return numbers;
}

/** Owner actions less than this many minutes apart are one sitting. */
export const BURST_GAP_MINUTES = 10;
/** A lone action still took the owner a moment. */
const MIN_BURST_MINUTES = 1;

export interface Rate {
  rate: number | null;
}

export interface Outcomes {
  mainRed: { runs: number; failed: number } & Rate;
  reverts: { reverts: number; merged: number } & Rate;
  liveRuns: { runs: number; passed: number } & Rate;
  /**
   * Owner minutes per merged change. The owner's login is shared with the
   * agents until they get their own identities (#336), so this is an upper
   * bound.
   */
  ownerMinutes: {
    minutes: number;
    merged: number;
    perMerged: number | null;
    burstGapMinutes: number;
    upperBound: true;
  };
}

export interface GuardBlocks {
  rule: string;
  blocks: number;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const ratio = (part: number, whole: number) =>
  whole === 0 ? null : round(part / whole);

/** Minutes of owner time: each burst from its first to its last action, at least a minute. */
function ownerMinutes(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let minutes = 0;
  let start = sorted[0];
  let last = sorted[0];
  for (const t of sorted.slice(1)) {
    if (t - (last as number) >= BURST_GAP_MINUTES * 60_000) {
      minutes += burst(start as number, last as number);
      start = t;
    }
    last = t;
  }
  return start === undefined ? 0 : minutes + burst(start, last as number);
}

const burst = (start: number, end: number) =>
  Math.max(MIN_BURST_MINUTES, (end - start) / 60_000);

export function outcomes(events: LedgerEvent[], window: Span): Outcomes {
  const inRange = events.filter((e) => inWindow(window, time(e)));
  const of = (kind: string) => inRange.filter((e) => e.kind === kind);
  const main = of("ci.main");
  const nightly = of("ci.nightly");
  const merged = of("pr.merged").length;
  const reverts = of("main.revert").length;
  const ideas = ideaNumbers(events);
  const minutes = ownerMinutes(
    of("owner.action")
      .filter((e) => e.number !== undefined && ideas.has(e.number))
      .map(time),
  );
  const failed = main.filter((e) => e.outcome === "failure").length;
  const passed = nightly.filter((e) => e.outcome === "success").length;
  return {
    mainRed: { runs: main.length, failed, rate: ratio(failed, main.length) },
    reverts: { reverts, merged, rate: ratio(reverts, merged) },
    liveRuns: {
      runs: nightly.length,
      passed,
      rate: ratio(passed, nightly.length),
    },
    ownerMinutes: {
      minutes: round(minutes),
      merged,
      perMerged: merged === 0 ? null : round(minutes / merged),
      burstGapMinutes: BURST_GAP_MINUTES,
      upperBound: true,
    },
  };
}

/** Blocks per guard rule in range, most blocked first, ties by rule name. */
export function guardBlocks(
  events: LedgerEvent[],
  window: Span,
): GuardBlocks[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (
      e.kind === "guard.block" &&
      e.label !== undefined &&
      inWindow(window, time(e))
    ) {
      counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([rule, blocks]) => ({ rule, blocks }))
    .sort((a, b) => b.blocks - a.blocks || a.rule.localeCompare(b.rule));
}
