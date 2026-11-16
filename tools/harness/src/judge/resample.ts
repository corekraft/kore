import type { LedgerEvent } from "../ledger/index.js";
import { VERDICT_HEAD_LENGTH } from "./review-verdict.js";

/** The sample each `review resample` run re-reviews. A placeholder until the owner tunes it (#852). */
export const RESAMPLE_SIZE = 5;
/** The tier a re-review pane runs on: a Sonnet reader, as spawned panes follow the Haiku-or-Sonnet rule. */
export const RESAMPLE_MODEL = "claude-sonnet-5-5";
export const RESAMPLE_EFFORT = "high";
/** Why the launch overrides the reader definition's tier; `session spawn` writes it into the launch event. */
export const RESAMPLE_REASON = "re-review of a passed review sample (#852)";

const VERDICT = /^(?:posted|unchanged):([0-9a-f]{7,40})$/;
const RESAMPLED = /^resample(?:-failed)?:([0-9a-f]{7,40})$/;

/** A passed review of a merged PR whose head has not been re-reviewed. */
export interface ResampleCandidate {
  pr: number;
  /** The head the passed verdict named, at the verdict's length. */
  head: string;
}

const short = (head: string): string => head.slice(0, VERDICT_HEAD_LENGTH);

/**
 * The passed reviews a re-review may draw from: a review.run that posted or left
 * unchanged a verdict with no findings, on a PR that has merged, for a head no
 * re-review has yet taken (passed or failed). One per PR head, by its first
 * verdict, earliest first. A review from before findings were recorded did not
 * pass, so it is left out.
 */
export function resampleCandidates(events: LedgerEvent[]): ResampleCandidate[] {
  const merged = new Set(
    events.filter((e) => e.kind === "pr.merged").map((e) => e.number),
  );
  const resampled = new Set<string>();
  for (const e of events) {
    const head = RESAMPLED.exec(e.label ?? "")?.[1];
    if (
      e.kind === "review.run" &&
      e.number !== undefined &&
      head !== undefined
    ) {
      resampled.add(`${e.number}\0${short(head)}`);
    }
  }
  const first = new Map<string, { candidate: ResampleCandidate; at: number }>();
  for (const e of events) {
    const head = VERDICT.exec(e.label ?? "")?.[1];
    if (
      e.kind !== "review.run" ||
      e.number === undefined ||
      head === undefined ||
      e.findings !== 0 ||
      !merged.has(e.number)
    ) {
      continue;
    }
    const key = `${e.number}\0${short(head)}`;
    if (resampled.has(key)) {
      continue;
    }
    const at = Date.parse(e.occurredAt);
    const prior = first.get(key);
    if (prior === undefined || at < prior.at) {
      first.set(key, {
        candidate: { pr: e.number, head: short(head) },
        at,
      });
    }
  }
  return [...first.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ candidate }) => candidate);
}

/**
 * A sample of `size` items drawn from the pool without replacement, one random
 * number per item. A pool no larger than the size is returned whole, in order, with
 * no draw. The pool itself is never changed.
 */
export function drawSample<T>(
  pool: readonly T[],
  size: number,
  random: () => number,
): T[] {
  if (pool.length <= size) {
    return [...pool];
  }
  const remaining = [...pool];
  const sample: T[] = [];
  while (sample.length < size) {
    const index = Math.min(
      remaining.length - 1,
      Math.floor(random() * remaining.length),
    );
    sample.push(...remaining.splice(index, 1));
  }
  return sample;
}
