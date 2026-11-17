// The `Last retrospective:` marker the retro scan's window opens at: finding the
// latest marker across the plans, and turning a marker into an instant. Moved out of
// retro-scan.ts unchanged, so that file stays within its line budget (#940).
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { CommandError } from "../runtime/index.js";

// The whole value on the line is captured, so a near-miss form is refused
// rather than read as its date. Group 1 is the prefix, group 2 the value.
const RETRO_MARKER = /^(\W*Last retrospective: )(\S.*?)[ \t\r]*$/gm;
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Where the plans live, relative to the repository root. */
export const PLANS_DIR = "infra/plans";

/**
 * A `Last retrospective:` value that is not a marker. It is an expected fault
 * the plan's author fixes, so callers catch it and say so, instead of letting
 * it end the hook as a harness fault.
 */
export class MarkerError extends CommandError {}

const notAMarker = (value: string): string =>
  `"${value}" is not a retrospective marker; write a date (YYYY-MM-DD) or a UTC timestamp with date -u +%Y-%m-%dT%H:%M:%SZ`;

/**
 * The instant a marker value opens the window at, in epoch ms, or NaN when the
 * value is not a marker. A bare date is local midnight of that day; a UTC
 * timestamp is that instant. Both must round-trip, so February 30 is refused
 * rather than rolled over to March 2.
 */
export function markerInstant(value: string): number {
  if (BARE_DATE.test(value)) {
    const midnight = new Date(`${value}T00:00:00`);
    return midnight.toLocaleDateString("sv") === value
      ? midnight.getTime()
      : Number.NaN;
  }
  if (UTC_TIMESTAMP.test(value)) {
    const instant = Date.parse(value);
    return Number.isFinite(instant) &&
      new Date(instant).toISOString() === value.replace(/Z$/, ".000Z")
      ? instant
      : Number.NaN;
  }
  return Number.NaN;
}

/** The latest `Last retrospective:` marker across the plans, or null. Throws, naming the plan line, for a value that is not a marker. */
export function lastRetrospective(
  plans: Readonly<Record<string, string>>,
): string | null {
  let latest: string | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const [plan, markdown] of Object.entries(plans)) {
    for (const match of markdown.matchAll(RETRO_MARKER)) {
      const prefix = match[1] ?? "";
      const value = match[2] ?? "";
      const instant = markerInstant(value);
      if (!Number.isFinite(instant)) {
        const line = markdown
          .slice(0, (match.index ?? 0) + prefix.length)
          .split("\n").length;
        throw new MarkerError(
          `${PLANS_DIR}/${plan}:${line}: ${notAMarker(value)}`,
        );
      }
      if (instant > latestAt) {
        latest = value;
        latestAt = instant;
      }
    }
  }
  return latest;
}

/**
 * Where the retrospective window opens, in epoch ms (0 without a marker). The
 * window is closed on the left: a session active at or after that instant is
 * in the next retrospective. A timestamp marker opens the window at that
 * instant, so two retrospectives on one day do not overlap. A date-only marker
 * opens at local midnight of its day, so the sessions of that day that the
 * earlier retrospective already reviewed are counted again; that is preferred
 * to losing the ones that ran later that day. Each transcript is one session,
 * so none is counted twice.
 */
export function windowStart(marker: string | undefined): number {
  if (!marker) {
    return 0;
  }
  const instant = markerInstant(marker);
  if (!Number.isFinite(instant)) {
    throw new MarkerError(notAMarker(marker));
  }
  return instant;
}
