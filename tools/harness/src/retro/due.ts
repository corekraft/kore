/** Closed ideas since the last retro that make one due (plan 12, Step 2). */
export const COUNT_THRESHOLD = 5;

export interface DueInput {
  /** Where the window opens, in epoch ms; 0 when no retro has run. */
  windowStart: number;
  /** Outcomes recorded for ideas; one idea may appear more than once. */
  closed: readonly { idea: string; at: number }[];
  /** Each trailing metric of the flow report, with the idea its latest value belongs to. */
  metrics: readonly { name: string; idea: string; worsened: boolean }[];
  /** retro-triggered events already recorded. */
  triggers: readonly { at: number; reason: string }[];
}

export type Due =
  | {
      due: false;
      closedIdeas: number;
      threshold: number;
      alreadyTriggered?: string;
    }
  | {
      due: true;
      reason: "count" | "metric";
      metric?: string;
      closedIdeas: number;
      threshold: number;
    };

/**
 * Whether a retro is due, from recorded data alone. A trigger recorded inside
 * the window does not fire again; a metric counts only when the idea it
 * measures closed inside the window, so one worsened idea cannot fire twice.
 */
export function decideRetro(input: DueInput): Due {
  const ideas = new Set(
    input.closed.filter((c) => c.at > input.windowStart).map((c) => c.idea),
  );
  const base = { closedIdeas: ideas.size, threshold: COUNT_THRESHOLD };
  const recorded = new Set(
    input.triggers.filter((t) => t.at > input.windowStart).map((t) => t.reason),
  );
  const candidates: {
    reason: "count" | "metric";
    metric?: string;
    key: string;
  }[] = [
    ...(ideas.size >= COUNT_THRESHOLD
      ? [{ reason: "count" as const, key: "count" }]
      : []),
    ...input.metrics
      .filter((m) => m.worsened && ideas.has(m.idea))
      .map((m) => ({
        reason: "metric" as const,
        metric: m.name,
        key: `metric:${m.name}`,
      })),
  ];
  const fresh = candidates.find((c) => !recorded.has(c.key));
  if (fresh !== undefined) {
    return {
      due: true,
      reason: fresh.reason,
      ...(fresh.metric === undefined ? {} : { metric: fresh.metric }),
      ...base,
    };
  }
  const seen = candidates[0];
  return seen === undefined
    ? { due: false, ...base }
    : { due: false, ...base, alreadyTriggered: seen.key };
}
