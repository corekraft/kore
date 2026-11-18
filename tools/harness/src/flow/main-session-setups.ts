// The setup of each main-session stretch (#1046, spec #1027): control, early compaction or
// Haiku, read from the recorded model, the largest prompt and the harness config's compaction
// cap when the report reads. Nothing writes the label and no flag or option can type it; a
// stretch the facts cannot label says "not set" or "insufficient" and is never guessed.
// A stretch is one main-session session on one recorded model, because a token.split reading
// is kept per session and model. Its largest prompt is the largest in any reading up to the
// window's end, since the readings are cumulative.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { tokenSession } from "./merged-tokens.js";
import { inWindow, type Span } from "./scope.js";
import { roleResolver } from "./stage-of.js";
import { MAIN_SESSION_MODEL } from "./writer-usage.js";

/** The setup a stretch ran under, or why it cannot be told. */
export type SetupLabel =
  "control" | "early compaction" | "Haiku" | "not set" | "insufficient";

/** One main-session stretch and its derived setup. */
export interface Stretch {
  session: string;
  /** The recorded model; null when the session has no token.split reading. */
  model: string | null;
  /** The largest prompt in the session's readings on that model; null with no reading. */
  largestPrompt: number | null;
  label: SetupLabel;
  /** Why the label is insufficient; absent on every other label. */
  reason?: string;
}

export type MainSessionSetups =
  | { status: "insufficient"; reason: string }
  | {
      status: "ok";
      /** The cap the labels were read against; null when the config sets none. */
      compactionCap: number | null;
      stretches: Stretch[];
    };

const NO_STRETCH = "no main-session reading recorded in the window";
const NO_READING = "no token.split reading recorded for the session";

interface Reading {
  session: string;
  model: string;
  largestPrompt: number;
}

/** The label the facts give a stretch with a reading, or insufficient with why. */
function labelOf(
  reading: Reading,
  cap: number | undefined,
): Pick<Stretch, "label" | "reason"> {
  if (cap === undefined) {
    return { label: "not set" };
  }
  if (/haiku/i.test(reading.model)) {
    return { label: "Haiku" };
  }
  if (reading.model === MAIN_SESSION_MODEL) {
    return {
      label: reading.largestPrompt > cap ? "control" : "early compaction",
    };
  }
  return {
    label: "insufficient",
    reason: `model ${reading.model} is neither the main-session model nor Haiku`,
  };
}

/** The largest prompt of each main-session session and model with a reading in the window. */
function readingsIn(
  events: LedgerEvent[],
  window: Span,
  hasRole: (event: LedgerEvent) => boolean,
): Map<string, Reading> {
  const readings = new Map<string, Reading>();
  const inside = events.filter(
    (e) =>
      e.kind === "token.split" &&
      e.model !== undefined &&
      e.largestPrompt !== undefined &&
      !hasRole(e) &&
      inWindow(window, time(e)),
  );
  for (const e of inside) {
    const session = tokenSession(e);
    const key = `${session}\u0000${e.model}`;
    readings.set(key, { session, model: e.model ?? "", largestPrompt: 0 });
  }
  for (const e of events) {
    const key = `${tokenSession(e)}\u0000${e.model}`;
    const seen = readings.get(key);
    if (
      seen !== undefined &&
      e.kind === "token.split" &&
      time(e) < window[1] &&
      (e.largestPrompt ?? 0) > seen.largestPrompt
    ) {
      seen.largestPrompt = e.largestPrompt ?? 0;
    }
  }
  return readings;
}

/** The main sessions with token totals in the window and no reading among the stretches. */
function bareSessions(
  events: LedgerEvent[],
  window: Span,
  hasRole: (event: LedgerEvent) => boolean,
  read: Set<string>,
): string[] {
  const bare = new Set<string>();
  for (const e of events) {
    const session = tokenSession(e);
    if (
      e.kind === "token.usage" &&
      !hasRole(e) &&
      inWindow(window, time(e)) &&
      !read.has(session)
    ) {
      bare.add(session);
    }
  }
  return [...bare];
}

/**
 * The setup of each main-session stretch in the window, against the compaction cap. A session
 * with a role is never read here. With no cap every stretch reads "not set", and a session
 * with token totals and no reading reads "insufficient"; neither is ever one of the three.
 */
export function mainSessionSetups(
  events: LedgerEvent[],
  window: Span,
  compactionCap: number | undefined,
): MainSessionSetups {
  const hasRole = roleResolver(events);
  const readings = [...readingsIn(events, window, hasRole).values()];
  const read = new Set(readings.map((r) => r.session));
  const stretches: Stretch[] = [
    ...readings.map((reading) => ({
      session: reading.session,
      model: reading.model,
      largestPrompt: reading.largestPrompt,
      ...labelOf(reading, compactionCap),
    })),
    ...bareSessions(events, window, hasRole, read).map((session): Stretch => ({
      session,
      model: null,
      largestPrompt: null,
      label: "insufficient",
      reason: NO_READING,
    })),
  ];
  if (stretches.length === 0) {
    return { status: "insufficient", reason: NO_STRETCH };
  }
  return { status: "ok", compactionCap: compactionCap ?? null, stretches };
}
