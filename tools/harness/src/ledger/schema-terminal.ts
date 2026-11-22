/**
 * The status a terminal event records (plan 16, Step 4 (e)): an hc status, `finished` once the terminal has
 * ended, or `unreported` while a live terminal has reported none.
 */
export const TERMINAL_STATUSES = [
  "idle",
  "working",
  "done",
  "blocked",
  "error",
  "finished",
  "unreported",
] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/**
 * A terminal event's reading: its status and its turn. With the terminal id they are the key the watch
 * records once per change, so a replayed or duplicate event is not written twice.
 */
export interface TerminalOrigin {
  status: TerminalStatus;
  turn: number;
}

/** Both fields are optional: every line written before the terminal source has neither, and still reads. */
export const TERMINAL_RULES = [
  {
    field: "status",
    check: (v: unknown) => TERMINAL_STATUSES.some((status) => status === v),
    hint: `must be one of ${TERMINAL_STATUSES.join(", ")}`,
  },
  {
    field: "turn",
    check: (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0,
    hint: "must be a whole number, 0 or more",
  },
] as const;
