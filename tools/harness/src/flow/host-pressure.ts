import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { median } from "./wip.js";

export const DEFAULT_HOST_DAYS = 7;
/** Fewer baseline samples than this give no spread worth comparing against. */
export const MIN_BASELINE_SAMPLES = 3;

const DAY_MS = 86_400_000;

export type HostBaseline =
  | {
      status: "ok";
      /** Samples at this level in the trailing period. */
      samples: number;
      median: number;
      /** Population standard deviation of those samples. */
      spread: number;
      /** The report's median is above the baseline median by more than the spread. */
      worsened: boolean;
    }
  | { status: "insufficient history"; samples: number; needed: number };

/** One reading (swap in bytes, or load) at one level; null when no sample read it. */
export interface HostFigure {
  median: number | null;
  peak: number | null;
  baseline: HostBaseline;
}

export interface HostLevel {
  /** Delivery-loop sessions live when the samples were taken. */
  sessions: number;
  /** Whether the local platform was up. */
  platform: boolean;
  samples: number;
  swap: HostFigure;
  load: HostFigure;
}

/** Host pressure by live-session count, from `host-sample` events. */
export interface HostPressure {
  /** The trailing days the baseline covers. */
  trailingDays: number;
  /** Samples in the report window; 0 means none were taken, not that the host was idle. */
  samples: number;
  levels: HostLevel[];
}

export interface HostOptions {
  trailingDays: number;
  /** Where the baseline ends when the report has no start. */
  asOf: Date;
}

type Reading = "swap" | "load";

const isSample = (e: LedgerEvent) =>
  e.kind === "host-sample" &&
  e.sessions !== undefined &&
  e.platform !== undefined;

const keyOf = (e: LedgerEvent) => `${e.sessions}|${e.platform}`;

/** Readings of one field; a sample that could not read it is left out, not counted as zero. */
const readings = (events: LedgerEvent[], field: Reading): number[] =>
  events.flatMap((e) => (e[field] === undefined ? [] : [e[field] as number]));

function baselineOf(current: number | null, before: number[]): HostBaseline {
  const mid = median(before);
  if (before.length < MIN_BASELINE_SAMPLES || mid === null) {
    return {
      status: "insufficient history",
      samples: before.length,
      needed: MIN_BASELINE_SAMPLES,
    };
  }
  const mean = before.reduce((sum, v) => sum + v, 0) / before.length;
  const spread = Math.sqrt(
    before.reduce((sum, v) => sum + (v - mean) ** 2, 0) / before.length,
  );
  return {
    status: "ok",
    samples: before.length,
    median: mid,
    spread,
    worsened: current !== null && current > mid + spread,
  };
}

function figure(
  now: LedgerEvent[],
  before: LedgerEvent[],
  field: Reading,
): HostFigure {
  const values = readings(now, field);
  const current = median(values);
  return {
    median: current,
    peak: values.length === 0 ? null : Math.max(...values),
    baseline: baselineOf(current, readings(before, field)),
  };
}

/**
 * Median and peak swap and load per live-session count, split by whether the
 * platform was up, over the report window. Each is compared with the median of
 * the same level over the trailing days before the window (before as-of when
 * the window has no start), flagged when above it by more than the spread.
 */
export function hostPressure(
  events: LedgerEvent[],
  window: Span,
  { trailingDays, asOf }: HostOptions,
): HostPressure {
  const end = Number.isFinite(window[0]) ? window[0] : asOf.getTime();
  const trailing: Span = [end - trailingDays * DAY_MS, end];
  const samples = events.filter(isSample);
  const inRange = samples.filter((e) => inWindow(window, time(e)));
  const earlier = samples.filter((e) => inWindow(trailing, time(e)));
  const groups = new Map<string, LedgerEvent[]>();
  for (const e of inRange) {
    groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e]);
  }
  const levels = [...groups.values()].map((now): HostLevel => {
    const first = now[0] as LedgerEvent;
    const before = earlier.filter((e) => keyOf(e) === keyOf(first));
    return {
      sessions: first.sessions as number,
      platform: first.platform as boolean,
      samples: now.length,
      swap: figure(now, before, "swap"),
      load: figure(now, before, "load"),
    };
  });
  levels.sort(
    (a, b) =>
      a.sessions - b.sessions || Number(a.platform) - Number(b.platform),
  );
  return { trailingDays, samples: inRange.length, levels };
}
