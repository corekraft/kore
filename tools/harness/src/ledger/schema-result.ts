import type { Kind } from "./schema.js";
import { isTimestamp } from "./schema-time.js";

const RESULT_KINDS: readonly Kind[] = ["session.result", "pane.finished"];
const RETRO_KINDS: readonly Kind[] = ["retro.main-session"];
const TIME_HINT =
  "must be an ISO 8601 UTC time such as 2026-01-02T03:04:05.000Z";
const isStamp = (v: unknown) => typeof v === "string" && isTimestamp(v);

/** A retro.main-session event's fields: the scanned window and the figures a scan counted (#940). */
export interface RetroOrigin {
  windowStart: string;
  windowEnd: string;
  pollMinutes: number;
  paneReads: number;
  signedSends: number;
  rawSends: number;
}
const TOOL_START_KINDS: readonly Kind[] = ["tool.start"];

/**
 * The background mark on a tool.start whose command runs in the background (#854).
 * Absent on every foreground call, so the mark is optional and only true when present.
 */
export const BACKGROUND_RULES = [
  {
    field: "background",
    check: (v: unknown) => v === true,
    hint: "must be true when present",
    kinds: TOOL_START_KINDS,
    optional: true,
  },
] as const;

/**
 * The outcome word a spawned session printed on its RESULT line, and nothing
 * else: a finish records the word, never the text around it (#853).
 */
export const RESULT_RULES = [
  {
    field: "result",
    check: (v: unknown) => v === "done" || v === "blocked",
    hint: "must be one of done, blocked",
    kinds: RESULT_KINDS,
    // hc reports no RESULT line, so a terminal's finish carries no outcome word; herdr's finish always does.
    omittableWhen: (raw: Record<string, unknown>) =>
      raw["kind"] === "pane.finished" && raw["source"] === "terminal",
  },
  // A retro scan's main-session figures (#940): its window and five numbers, never command text.
  {
    field: "windowStart",
    check: isStamp,
    hint: TIME_HINT,
    kinds: RETRO_KINDS,
  },
  {
    field: "windowEnd",
    check: isStamp,
    hint: TIME_HINT,
    kinds: RETRO_KINDS,
  },
  {
    field: "pollMinutes",
    check: (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0,
    hint: "must be a finite non-negative number of minutes",
    kinds: RETRO_KINDS,
  },
  ...["paneReads", "signedSends", "rawSends"].map((field) => ({
    field,
    check: (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0,
    hint: "must be a non-negative whole number",
    kinds: RETRO_KINDS,
  })),
] as const;
