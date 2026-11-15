import type { Result } from "../outcome/index.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The figure at a dotted path in a flow report: a number as it is, a cost
 * metric as its current value, and nothing (null) for a missing path, a null or
 * a cost metric with insufficient history.
 */
export function readMetric(report: unknown, path: string): number | null {
  let node: unknown = report;
  for (const key of path.split(".")) {
    node = isRecord(node) ? node[key] : undefined;
  }
  if (typeof node === "number") {
    return node;
  }
  if (isRecord(node) && node["status"] === "ok") {
    const current = node["current"];
    return typeof current === "number" ? current : null;
  }
  return null;
}

export interface Judgement {
  result: Result;
  /** Relative change from before to after; null when there was no figure to judge. */
  change: number | null;
  reason: string;
}

export interface JudgeInput {
  direction: "up" | "down";
  before: number | null;
  after: number | null;
  /** Relative change counted as signal; 0.1 is 10%. */
  threshold: number;
}

/** Confirmed or refuted only on a move past the threshold; anything else, and any missing figure, is inconclusive. */
export function judgeChange({
  direction,
  before,
  after,
  threshold,
}: JudgeInput): Judgement {
  if (before === null || after === null || before === 0) {
    return {
      result: "inconclusive",
      change: null,
      reason: "insufficient history",
    };
  }
  const change = (after - before) / Math.abs(before);
  const toward = direction === "up" ? change : -change;
  const percent = `${Math.round(Math.abs(change) * 1000) / 10}%`;
  const moved = `moved ${change >= 0 ? "up" : "down"} ${percent}`;
  if (toward >= threshold) {
    return { result: "confirmed", change, reason: moved };
  }
  if (toward <= -threshold) {
    return { result: "refuted", change, reason: moved };
  }
  return {
    result: "inconclusive",
    change,
    reason: `${moved}, within the noise threshold`,
  };
}
